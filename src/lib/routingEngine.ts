import {
  ActivityType,
  ApiConfiguration,
  DistanceUnit,
  ElevationPoint,
  ElevationPreference,
  GeneratedRoute,
  LatLng,
  PrivacyMaskInfo,
  RouteStats,
  RouteType,
  SafeCrossing,
  TechnicalSegmentWarning,
} from '../types/route';
import { CONTINUOUS_GLYPHS, GLYPH_STROKES } from './glyphEngine';

// Earth radius in meters
const EARTH_RADIUS_M = 6371000;

/**
 * Calculates Haversine distance in meters between two lat/lng points
 */
export function calculateDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculate total distance along a polyline in kilometers
 */
export function calculateTotalDistanceKm(points: [number, number][]): number {
  let totalM = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalM += calculateDistanceMeters(points[i], points[i + 1]);
  }
  return totalM / 1000;
}

/**
 * Corridor node discovered via OpenStreetMap (greenbelt, greenway, park, sidewalk, hiking trail, or mtb trail)
 */
export interface CorridorNode {
  lat: number;
  lng: number;
  type: 'park' | 'greenway' | 'trail' | 'sidewalk' | 'waterway' | 'quiet_street' | 'bike_lane' | 'mtb_trail' | 'gravel_path';
  name?: string;
  surface?: string;
  mtbScale?: number;
}

/**
 * Check if the selected activity is any bicycling variant
 */
export function isBikeActivity(activity: ActivityType): boolean {
  return activity === 'road_bike' || activity === 'mountain_bike' || activity === 'bike';
}

// In-memory cache for fast repeated queries in the same region
const corridorCache = new Map<string, CorridorNode[]>();

// In-memory cache for airport zones to completely avoid routing towards airports
interface AirportZone {
  lat: number;
  lng: number;
  radiusM: number;
}
const airportCache = new Map<string, AirportZone[]>();

// In-memory cache for unpaved trails to ensure road bike NEVER enters dirt areas
const unpavedTrailCache = new Map<string, [number, number][]>();

/**
 * Checks if a road, way, or name belongs to airport infrastructure
 */
export function isAirportInfrastructure(tags?: Record<string, string>, name?: string, ref?: string): boolean {
  if (tags) {
    if (tags.aeroway) return true;
    if (tags.amenity === 'airport' || tags.amenity === 'airfield') return true;
    if (tags.military === 'airfield' || tags.military === 'air_base') return true;
    if (tags.landuse === 'aerodrome') return true;
  }
  const checkStr = `${name || ''} ${ref || ''} ${tags?.name || ''} ${tags?.ref || ''} ${tags?.description || ''}`.toLowerCase();
  return /\b(airport|airfield|airstrip|aerodrome|runway|taxiway|hangar|boeing|lockheed|terminal st|terminal way|terminal rd|aviation|flightline|air cargo)\b/i.test(
    checkStr
  );
}

/**
 * Checks if a road's speed limit exceeds 30 mph (or 50 km/h)
 */
export function isRoadSpeedLimitOver30(tags?: Record<string, string>, name?: string): boolean {
  if (tags) {
    const maxspeed = (tags.maxspeed || '').trim().toLowerCase();
    if (maxspeed) {
      const numMatch = maxspeed.match(/^(\d+)/);
      if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (maxspeed.includes('mph')) {
          return val > 30;
        }
        if (maxspeed.includes('km/h') || maxspeed.includes('kph') || maxspeed.includes('kmh')) {
          return val > 50;
        }
        return val > 30;
      }
    }
    const hwy = tags.highway || '';
    if (/^(motorway|motorway_link|trunk|trunk_link)$/.test(hwy)) {
      return true;
    }
    if (/^(primary|primary_link)$/.test(hwy) && !tags.cycleway && !tags.sidewalk && tags.bicycle !== 'designated') {
      return true;
    }
  }
  if (name && /\b(interstate|freeway|fwy|expressway|turnpike|hwy \d|us-\d|i-\d|state highway)\b/i.test(name)) {
    return true;
  }
  return false;
}

/**
 * Discovers airport centers to guarantee no routes are generated towards aerodromes
 */
export async function discoverAirportZones(center: LatLng, radiusKm: number): Promise<AirportZone[]> {
  const cacheKey = `${center.lat.toFixed(2)}_${center.lng.toFixed(2)}`;
  if (airportCache.has(cacheKey)) {
    return airportCache.get(cacheKey)!;
  }

  const radiusMeters = Math.min(30000, Math.max(2500, Math.round(radiusKm * 1000 * 1.5)));
  const queryBody = `
    [out:json][timeout:3];
    (
      way["aeroway"~"aerodrome|runway|taxiway|apron"](around:${radiusMeters},${center.lat},${center.lng});
      node["aeroway"~"aerodrome|terminal"](around:${radiusMeters},${center.lat},${center.lng});
      relation["aeroway"="aerodrome"](around:${radiusMeters},${center.lat},${center.lng});
    );
    out center 20;
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(queryBody)}`,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const zones: AirportZone[] = [];
      for (const el of data.elements || []) {
        const lat = el.center ? el.center.lat : el.lat;
        const lng = el.center ? el.center.lon : el.lon;
        if (lat && lng) {
          zones.push({ lat, lng, radiusM: 2500 });
        }
      }
      airportCache.set(cacheKey, zones);
      return zones;
    }
  } catch {
    // fallback
  }

  return [];
}

/**
 * Discovers corridors tailored to user preferences:
 * - Running: Roads to greenways, greenbelts, parks, sidewalks, and quiet neighborhood streets while avoiding heavy traffic.
 * - Road Bike: Prioritizes designated bike lanes, paved greenways, and low-stress bike-friendly roads (<=30mph). 0% unpaved tolerance.
 * - Mountain Bike: Roads to trailheads, then singletracks/trails, then roads. Strictly excludes residential city grid dilution.
 * - Hike: Unpaved nature trails, footpaths, and nature reserves.
 */
export async function discoverCorridorNodes(
  center: LatLng,
  radiusKm: number,
  activity: ActivityType
): Promise<CorridorNode[]> {
  const cacheKey = `${activity}_${center.lat.toFixed(2)}_${center.lng.toFixed(2)}_${Math.round(radiusKm * 10)}`;
  if (corridorCache.has(cacheKey)) {
    return corridorCache.get(cacheKey)!;
  }

  // Pre-fetch airport locations in parallel
  const airportZones = await discoverAirportZones(center, radiusKm);

  const radiusMeters = Math.min(25000, Math.max(800, Math.round(radiusKm * 1000 * 1.3)));

  let queryBody = '';
  if (activity === 'hike') {
    // Hiking: focus on actual trails, footpaths, tracks, hiking routes, nature reserves
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"~"path|track|footway|bridleway"]["highway"!~"living_street|service|construction"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="hiking"](around:${radiusMeters},${center.lat},${center.lng});
        node["highway"="trailhead"](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"="nature_reserve"](around:${radiusMeters},${center.lat},${center.lng});
        way["natural"~"wood|peak|ridge|cliff"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 40;
    `;
  } else if (activity === 'mountain_bike') {
    // Mountain Bike: prioritize singletracks, MTB tracks, and trailheads.
    // Explicitly exclude residential city roads from Overpass to prevent city grid dilution!
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"~"track|path|bridleway"]["bicycle"!~"no"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="mtb"](around:${radiusMeters},${center.lat},${center.lng});
        way["route"="mtb"](around:${radiusMeters},${center.lat},${center.lng});
        way["mtb:scale"](around:${radiusMeters},${center.lat},${center.lng});
        node["highway"="trailhead"](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"="nature_reserve"]["bicycle"!~"no"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"track|path|cycleway"]["surface"~"gravel|fine_gravel|compacted|dirt|unpaved|ground|earth"]["bicycle"!~"no"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 100;
    `;
  } else if (activity === 'road_bike' || activity === 'bike') {
    // Road Bike: designated bike lanes, paved greenways, and low-stress bike-friendly roads <= 30 mph.
    // Strictly exclude unpaved surfaces and highways with speed limit > 30 mph.
    queryBody = `
      [out:json][timeout:4];
      (
        way["name"~"greenbelt|greenway|cycleway|bike path",i]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        relation["name"~"greenbelt|greenway|cycleway",i](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"="cycleway"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        way["cycleway"~"lane|track|opposite_lane|opposite_track"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        way["bicycle"="designated"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"cycleway|path"]["surface"~"paved|asphalt|concrete|paving_stones|chipseal"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        way["cyclestreet"="yes"](around:${radiusMeters},${center.lat},${center.lng});
        way["bicycle_road"="yes"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"residential|living_street"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["bicycle"!~"no"]["maxspeed"!~"^(3[1-9]|[4-9][0-9]|[1-9][0-9]{2})"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="bicycle"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"track|path"]["surface"~"unpaved|dirt|gravel|ground|earth|sand"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 100;
    `;
  } else {
    // Running: prioritizes greenways, greenbelts, parks, and calm neighborhood street layouts (never zig-zagging sidewalks).
    queryBody = `
      [out:json][timeout:4];
      (
        way["name"~"greenbelt|greenway|riverwalk|river path",i]["footway"!~"sidewalk|crossing"](around:${radiusMeters},${center.lat},${center.lng});
        relation["name"~"greenbelt|greenway|riverwalk",i](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"cycleway|path|pedestrian|footway"]["footway"!~"sidewalk|crossing|traffic_island|access_aisle"]["foot"!~"no"]["highway"!~"motorway|trunk|primary|secondary|service|construction"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"~"park|garden|nature_reserve"](around:${radiusMeters},${center.lat},${center.lng});
        way["landuse"~"greenfield|recreation_ground|grass|village_green"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"living_street|residential|unclassified"]["maxspeed"!~"^(3[1-9]|[4-9][0-9]|[1-9][0-9]{2})"]["aeroway"!~"."](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"~"running|foot"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 120;
    `;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(queryBody)}`,
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json();
          clearTimeout(timeoutId);

          if (data.elements && data.elements.length > 0) {
            const nodes: CorridorNode[] = [];
            for (const el of data.elements) {
              const lat = el.center ? el.center.lat : el.lat;
              const lng = el.center ? el.center.lon : el.lon;
              if (lat && lng) {
                const dist = calculateDistanceMeters([center.lat, center.lng], [lat, lng]) / 1000;
                if (dist <= radiusKm * 1.5 && dist >= 0.1) {
                  // Airport rejection filter: eliminate any airport nodes or aerodrome vicinity
                  if (isAirportInfrastructure(el.tags, el.tags?.name, el.tags?.ref)) {
                    continue;
                  }
                  if (airportZones.some((az) => calculateDistanceMeters([lat, lng], [az.lat, az.lng]) <= az.radiusM)) {
                    continue;
                  }

                  // Mandate: Limit speed limit on all roads to 30mph and under
                  if (isRoadSpeedLimitOver30(el.tags, el.tags?.name)) {
                    continue;
                  }

                  // Exclude separate street sidewalks & crosswalks so paved routes follow road centerlines
                  const footwayTag = (el.tags?.footway || '').toLowerCase();
                  if (
                    activity !== 'hike' &&
                    (footwayTag === 'sidewalk' ||
                      footwayTag === 'crossing' ||
                      footwayTag === 'traffic_island' ||
                      footwayTag === 'access_aisle')
                  ) {
                    continue;
                  }

                  const surfaceTag = (el.tags?.surface || '').toLowerCase();
                  const unpavedRegex = /unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone/i;
                  const isUnpaved = unpavedRegex.test(surfaceTag);

                  // Track unpaved trails in the region to protect road bike
                  if (isUnpaved || el.tags?.highway === 'track' || el.tags?.highway === 'path') {
                    const trailCacheKey = `${center.lat.toFixed(2)}_${center.lng.toFixed(2)}`;
                    const existing = unpavedTrailCache.get(trailCacheKey) || [];
                    existing.push([lat, lng]);
                    unpavedTrailCache.set(trailCacheKey, existing);
                  }

                  // MANDATE: Road bike should NEVER use an unpaved trail
                  if (activity === 'road_bike' || activity === 'bike') {
                    if (isUnpaved) {
                      continue; // Immediately discard unpaved surface for road bike
                    }
                    if (el.tags?.highway === 'path' || el.tags?.highway === 'track' || el.tags?.highway === 'bridleway') {
                      if (!/paved|asphalt|concrete|paving_stones|chipseal/i.test(surfaceTag)) {
                        continue; // Strictly reject non-paved trails for road bike
                      }
                    }
                  }

                  let nodeType: CorridorNode['type'] = 'greenway';
                  let mtbScale: number | undefined = undefined;

                  if (activity === 'hike') {
                    nodeType = 'trail';
                  } else if (activity === 'mountain_bike') {
                    // Detect and parse mtb:scale (0 to 6)
                    const scaleStr = el.tags?.['mtb:scale'] || el.tags?.['mtb:scale:uphill'];
                    if (scaleStr !== undefined) {
                      const match = String(scaleStr).match(/(\d+)/);
                      if (match) {
                        mtbScale = parseInt(match[1], 10);
                      }
                    }

                    const isExplicitMtb =
                      el.tags?.route === 'mtb' ||
                      el.tags?.highway === 'trailhead' ||
                      mtbScale !== undefined;

                    const isGravelOrUnpaved =
                      /gravel|fine_gravel|compacted|dirt|unpaved|ground|earth/i.test(surfaceTag) ||
                      el.tags?.highway === 'track' ||
                      (el.tags?.highway === 'path' && !isExplicitMtb);

                    if (isExplicitMtb) {
                      nodeType = 'mtb_trail';
                    } else if (isGravelOrUnpaved) {
                      nodeType = 'gravel_path';
                    } else if (el.tags?.highway === 'residential') {
                      nodeType = 'quiet_street';
                    } else {
                      nodeType = 'gravel_path';
                    }
                  } else if (activity === 'road_bike' || activity === 'bike') {
                    if (el.tags?.name && /greenbelt|greenway|riverwalk|river path|cycleway|bike path/i.test(el.tags.name)) {
                      nodeType = 'greenway';
                    } else if (el.tags?.cycleway || el.tags?.bicycle === 'designated') {
                      nodeType = 'bike_lane';
                    } else if (
                      el.tags?.highway === 'cycleway' ||
                      el.tags?.surface === 'paved' ||
                      el.tags?.surface === 'asphalt' ||
                      el.tags?.surface === 'concrete'
                    ) {
                      nodeType = 'greenway';
                    } else {
                      nodeType = 'quiet_street';
                    }
                  } else if (activity === 'run') {
                    if (
                      (el.tags?.name && /greenbelt|greenway|riverwalk|river path|esplanade/i.test(el.tags.name)) ||
                      el.tags?.highway === 'cycleway'
                    ) {
                      nodeType = 'greenway';
                    } else if (el.tags?.leisure === 'park' || el.tags?.leisure === 'garden' || el.tags?.landuse) {
                      nodeType = 'park';
                    } else if (
                      el.tags?.highway === 'residential' ||
                      el.tags?.highway === 'living_street' ||
                      el.tags?.highway === 'unclassified'
                    ) {
                      nodeType = 'quiet_street';
                    } else {
                      nodeType = 'quiet_street';
                    }
                  }

                  nodes.push({
                    lat,
                    lng,
                    type: nodeType,
                    name: el.tags?.name,
                    surface: el.tags?.surface,
                    mtbScale,
                  });
                }
              }
            }

            if (nodes.length > 0) {
              corridorCache.set(cacheKey, nodes);
              return nodes;
            }
          }
        }
      } catch {
        // try next mirror
      }
    }
    clearTimeout(timeoutId);
  } catch {
    // fallback gracefully
  }

  return [];
}

export interface SafeCrossingNode {
  lat: number;
  lng: number;
  type: 'traffic_signals' | 'stop' | 'marked_crossing';
  name?: string;
  roadName?: string;
}

// In-memory cache for safe crossings
const safeCrossingCache = new Map<string, SafeCrossingNode[]>();

/**
 * Discovers verified controlled crossings (traffic lights, stop signs, pedestrian signals)
 */
export async function discoverSafeCrossings(
  center: LatLng,
  radiusKm: number
): Promise<SafeCrossingNode[]> {
  const cacheKey = `${center.lat.toFixed(2)}_${center.lng.toFixed(2)}_${Math.round(radiusKm * 10)}`;
  if (safeCrossingCache.has(cacheKey)) {
    return safeCrossingCache.get(cacheKey)!;
  }

  const radiusMeters = Math.min(15000, Math.max(500, Math.round(radiusKm * 1000 * 1.3)));
  const queryBody = `
    [out:json][timeout:3];
    (
      node["highway"~"traffic_signals|stop"](around:${radiusMeters},${center.lat},${center.lng});
      node["crossing"~"traffic_signals|marked"](around:${radiusMeters},${center.lat},${center.lng});
      node["crossing:signals"="yes"](around:${radiusMeters},${center.lat},${center.lng});
    );
    out 60;
  `;

  const endpoints = [
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2800);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(queryBody)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.elements && data.elements.length > 0) {
          const nodes: SafeCrossingNode[] = [];
          for (const el of data.elements) {
            const lat = el.lat;
            const lng = el.lon;
            if (lat && lng) {
              const type: SafeCrossingNode['type'] =
                el.tags?.highway === 'traffic_signals' ||
                el.tags?.crossing === 'traffic_signals' ||
                el.tags?.['crossing:signals'] === 'yes'
                  ? 'traffic_signals'
                  : el.tags?.highway === 'stop'
                  ? 'stop'
                  : 'marked_crossing';

              nodes.push({
                lat,
                lng,
                type,
                name: el.tags?.name,
                roadName: el.tags?.['addr:street'] || el.tags?.name,
              });
            }
          }

          if (nodes.length > 0) {
            safeCrossingCache.set(cacheKey, nodes);
            return nodes;
          }
        }
      }
    } catch {
      // try next mirror
    }
  }

  return [];
}

/**
 * Detects if a street name or highway corridor represents a major arterial thoroughfare
 */
export function isMajorArterialRoad(name?: string): boolean {
  if (!name || name.trim().length === 0) return false;
  return /\b(highway|hwy|freeway|fwy|expressway|turnpike|interstate|state route|sr-\d|us-\d|i-\d)\b/i.test(
    name
  );
}

/**
 * Detects illegal or high-risk pedestrian access such as freeway on/off ramps or interstates
 */
export function isProhibitedFreewayOrRamp(step: any): boolean {
  if (!step) return false;
  if (
    step.maneuver?.type === 'on ramp' ||
    step.maneuver?.type === 'off ramp' ||
    (step.maneuver?.type === 'merge' && /highway|freeway|interstate|expressway/i.test(step.name || ''))
  ) {
    return true;
  }
  return /\b(interstate|freeway|turnpike|expressway)\b/i.test(step.name || '');
}

function calculateHeadingDeg(p1: [number, number], p2: [number, number]): number {
  const dLat = p2[0] - p1[0];
  const dLng = (p2[1] - p1[1]) * Math.cos((p1[0] * Math.PI) / 180);
  let deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function calculateAngleDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Eliminates unwanted spurs, cul-de-sac antennas, and erratic alley detours across loops and out-and-backs.
 * - Dead-end spurs: The route detours out into a side street, driveway, court, or cul-de-sac
 *   and retraces back to the same junction or street corridor.
 * - Micro-detours: The route deviates from a continuous through-way into an alley or parking row
 *   and rejoins the continuous thoroughfare.
 * Preserves authentic 90-degree intersection turns without cutting across corner buildings or blocks.
 */
export function eliminateSpursAndInAndOuts(
  coordinates: [number, number][],
  isLoop: boolean = false
): [number, number][] {
  if (!coordinates || coordinates.length < 5) return coordinates || [];

  let pts: [number, number][] = [...coordinates];
  let changed = true;
  let passes = 0;

  while (changed && passes < 10) {
    changed = false;
    passes++;

    // 1. Detect dead-end backtrack spurs / cul-de-sacs
    // The path detours out into a dead-end side street and retraces directly back along the same corridor
    for (let i = 0; i < pts.length - 4; i++) {
      let accumulatedPathM = 0;
      let maxReachM = 0;
      let bestK = -1;

      for (let k = i + 1; k < Math.min(pts.length, i + 80); k++) {
        accumulatedPathM += calculateDistanceMeters(pts[k - 1], pts[k]);
        if (accumulatedPathM > 500) break;

        const gapDist = calculateDistanceMeters(pts[i], pts[k]);
        if (gapDist > maxReachM) maxReachM = gapDist;

        if (k >= i + 3) {
          // In a closed loop, never prune loop closure between start and finish
          if (isLoop && i <= 1 && k >= pts.length - 3) continue;

          // Strict backtrack condition:
          // Path travels into cul-de-sac/dead-end and returns right back to the junction (gap <= 8m)
          // with significant excursion (>= 25m) where gap is a tiny fraction of excursion.
          if (accumulatedPathM >= 25 && gapDist <= 8 && maxReachM >= 20 && gapDist < maxReachM * 0.25) {
            bestK = k;
          }
        }
      }

      if (bestK !== -1) {
        pts.splice(i + 1, bestK - i - 1);
        changed = true;
        break;
      }
    }
  }

  // 2. Deduplicate consecutive identical points without altering road curvature or corners
  const clean: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (clean.length === 0 || calculateDistanceMeters(clean[clean.length - 1], pts[i]) >= 1.0) {
      clean.push(pts[i]);
    }
  }
  if (pts.length > 1 && clean[clean.length - 1] !== pts[pts.length - 1]) {
    clean.push(pts[pts.length - 1]);
  }

  return clean;
}

function pointToSegmentDistanceMeters(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const latRad = (a[0] * Math.PI) / 180;
  const mPerLat = 111132.0;
  const mPerLng = 111320.0 * Math.cos(latRad);

  const bx = (b[1] - a[1]) * mPerLng;
  const by = (b[0] - a[0]) * mPerLat;
  const px = (p[1] - a[1]) * mPerLng;
  const py = (p[0] - a[0]) * mPerLat;

  const lenSq = bx * bx + by * by;
  if (lenSq < 1e-6) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

function rdpSimplifyRange(
  points: [number, number][],
  epsilonMeters: number
): [number, number][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let splitIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistanceMeters(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  if (maxDist > epsilonMeters && splitIdx > 0 && splitIdx < points.length - 1) {
    const left = rdpSimplifyRange(points.slice(0, splitIdx + 1), epsilonMeters);
    const right = rdpSimplifyRange(points.slice(splitIdx), epsilonMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

/**
 * Eliminates small lateral sidewalk/curb-cut jogs, driveway bumps, and collinear jitter
 * along straight road corridors while preserving true street intersections and smooth road curves.
 * Dramatically reduces false left/right smartwatch turn alerts on GPX exports.
 */
export function minimizeMicroTurns(
  coordinates: [number, number][],
  isClosedCircuit: boolean = false
): [number, number][] {
  if (!coordinates || coordinates.length < 4) return coordinates || [];

  let pts: [number, number][] = [...coordinates];

  // Pass 1: Remove parallel lateral curb-cut / sidewalk / crosswalk-island bumps
  // (where entry and exit headings are aligned within 22° and lateral excursion <= 6m)
  let changed = true;
  let passes = 0;
  while (changed && passes < 4) {
    changed = false;
    passes++;

    for (let i = 1; i < pts.length - 3; i++) {
      // Find stable anchor before i (~8m+ back)
      let prevIdx = i - 1;
      while (prevIdx > 0 && calculateDistanceMeters(pts[prevIdx], pts[i]) < 8) {
        prevIdx--;
      }
      if (calculateDistanceMeters(pts[prevIdx], pts[i]) < 6) continue;
      const headingBefore = calculateHeadingDeg(pts[prevIdx], pts[i]);

      let removed = false;
      for (let j = Math.min(pts.length - 2, i + 12); j >= i + 2; j--) {
        const chordM = calculateDistanceMeters(pts[i], pts[j]);
        if (chordM < 8 || chordM > 75) continue;

        // Find stable anchor after j (~8m+ ahead)
        let nextIdx = j + 1;
        while (nextIdx < pts.length - 1 && calculateDistanceMeters(pts[j], pts[nextIdx]) < 8) {
          nextIdx++;
        }
        if (calculateDistanceMeters(pts[j], pts[nextIdx]) < 6) continue;

        const headingChord = calculateHeadingDeg(pts[i], pts[j]);
        const headingAfter = calculateHeadingDeg(pts[j], pts[nextIdx]);

        // Only flatten when the corridor continues in the same direction (never flatten 45°/90° turns or U-turns)
        if (
          calculateAngleDelta(headingBefore, headingChord) > 22 ||
          calculateAngleDelta(headingChord, headingAfter) > 22 ||
          calculateAngleDelta(headingBefore, headingAfter) > 22
        ) {
          continue;
        }

        let maxDevM = 0;
        let subPathM = 0;
        for (let k = i + 1; k < j; k++) {
          const dev = pointToSegmentDistanceMeters(pts[k], pts[i], pts[j]);
          if (dev > maxDevM) maxDevM = dev;
        }
        for (let k = i; k < j; k++) {
          subPathM += calculateDistanceMeters(pts[k], pts[k + 1]);
        }

        if (maxDevM > 0.3 && maxDevM <= 6.0 && subPathM <= chordM + 10.0) {
          pts.splice(i + 1, j - i - 1);
          changed = true;
          removed = true;
          break;
        }
      }
      if (removed) break;
    }
  }

  // Pass 2: Tight 1.6m RDP simplification to remove collinear node wobble without clipping corners
  if (pts.length >= 4) {
    if (isClosedCircuit && calculateDistanceMeters(pts[0], pts[pts.length - 1]) <= 60) {
      const mid = Math.floor(pts.length / 2);
      const firstHalf = rdpSimplifyRange(pts.slice(0, mid + 1), 1.6);
      const secondHalf = rdpSimplifyRange(pts.slice(mid), 1.6);
      pts = [...firstHalf.slice(0, -1), ...secondHalf];
    } else {
      pts = rdpSimplifyRange(pts, 1.6);
    }
  }

  return pts;
}

/**
 * Counts actual significant turns (>= 30° heading change across >= 15m legs)
 */
export function countSignificantTurns(coordinates: [number, number][]): number {
  if (!coordinates || coordinates.length < 3) return 0;

  let turns = 0;
  let i = 0;
  while (i < coordinates.length - 2) {
    let j = i + 1;
    while (j < coordinates.length - 1 && calculateDistanceMeters(coordinates[i], coordinates[j]) < 15) {
      j++;
    }
    if (j >= coordinates.length - 1) break;

    let k = j + 1;
    while (k < coordinates.length - 1 && calculateDistanceMeters(coordinates[j], coordinates[k]) < 15) {
      k++;
    }

    const h1 = calculateHeadingDeg(coordinates[i], coordinates[j]);
    const h2 = calculateHeadingDeg(coordinates[j], coordinates[k]);
    if (calculateAngleDelta(h1, h2) >= 30) {
      turns++;
    }
    i = j;
  }

  return turns;
}

/**
 * Fetch real-world road snapped path using HeiGIT / OpenRouteService or public OpenStreetMap OSRM.
 * Prefers road centerlines and paved greenways over zig-zagging sidewalks whenever routing on paved areas.
 */
export async function fetchRealRoadPath(
  waypoints: [number, number][],
  activity: ActivityType,
  apiConfig?: ApiConfiguration,
  skipSpurPruning: boolean = false,
  allowUTurns: boolean = false,
  safeCrossingNodes: SafeCrossingNode[] = [],
  preferRoadLayout: boolean = false
): Promise<{
  coordinates: [number, number][];
  distanceKm: number;
  safeCrossings: SafeCrossing[];
  hasProhibitedRamps: boolean;
  hasAirportProximity?: boolean;
  hasHighSpeedRoad?: boolean;
  hasUnpavedTrail?: boolean;
} | null> {
  if (waypoints.length < 2) return null;

  const useRoadLayoutProfile = preferRoadLayout || activity !== 'hike';

  // 1. Try OpenRouteService / HeiGIT if API key is configured
  const orsKey = apiConfig?.openRouteServiceKey?.trim();
  if (orsKey && orsKey.length > 10) {
    try {
      // For paved road-layout preference (run, road_bike, gps_art), prefer cycling-road/cycling-regular
      // so ORS routes along street centerlines & paved greenways instead of jagged footway sidewalks.
      const orsProfile =
        activity === 'mountain_bike'
          ? 'cycling-mountain'
          : activity === 'road_bike' || useRoadLayoutProfile
          ? 'cycling-road'
          : isBikeActivity(activity)
          ? 'cycling-regular'
          : activity === 'hike'
          ? 'foot-hiking'
          : 'cycling-road';

      const endpoints = [
        `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`,
        `https://api.heigit.org/v2/directions/${orsProfile}/geojson`,
      ];

      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: orsKey,
              'Content-Type': 'application/json',
              Accept: 'application/json, application/geo+json',
            },
            body: JSON.stringify({
              coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
              preference: 'recommended',
              options: {
                avoid_features:
                  activity === 'road_bike' || activity === 'bike'
                    ? ['highways', 'tollways', 'ferries', 'unpavedroads', 'steps']
                    : ['highways', 'tollways', 'ferries'],
              },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            if (data.features && data.features.length > 0 && data.features[0].geometry) {
              const geoCoords: [number, number][] = data.features[0].geometry.coordinates.map(
                ([lng, lat]: [number, number]) => [lat, lng]
              );
              const pruned = skipSpurPruning
                ? geoCoords
                : eliminateSpursAndInAndOuts(geoCoords, false);
              const cleanCoords = minimizeMicroTurns(pruned, false);
              const distKm = calculateTotalDistanceKm(cleanCoords);

              return {
                coordinates: cleanCoords,
                distanceKm: distKm,
                safeCrossings: [],
                hasProhibitedRamps: false,
              };
            }
          }
        } catch {
          // try next endpoint or fallback
        }
      }
    } catch (orsErr) {
      console.warn('OpenRouteService request error, falling back to OSRM:', orsErr);
    }
  }

  // 2. Query Public OpenStreetMap OSRM Routing Engines (Free, accurate real-road routing)
  const coordString = waypoints.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');

  // Profiles based on activity & paved road-layout priority:
  // - road_bike / bike: routed-bike -> bike -> driving (paved road centerlines & greenways, zero sidewalks)
  // - run (and paved GPS Art): routed-bike -> bike -> driving first so paved routes follow road centerlines
  //   instead of zig-zagging sidewalks, falling back to routed-foot only for pedestrian-only park links
  // - mountain_bike: routed-bike with routed-foot fallback for singletracks
  // - hike: routed-foot for off-road nature trails (or road layout when preferRoadLayout is true)
  const continueStraight = allowUTurns ? '' : '&continue_straight=true';
  const extraParams = `${continueStraight}&steps=true&annotations=true`;
  const osrmEndpoints =
    activity === 'mountain_bike'
      ? [
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/bike/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
        ]
      : isBikeActivity(activity)
      ? [
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/bike/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
        ]
      : useRoadLayoutProfile
      ? [
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/bike/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/foot/${coordString}?overview=full&geometries=geojson${extraParams}`,
        ]
      : [
          `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/foot/${coordString}?overview=full&geometries=geojson${extraParams}`,
          `https://router.project-osrm.org/route/v1/walking/${coordString}?overview=full&geometries=geojson${extraParams}`,
        ];

  for (const url of osrmEndpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const rawCoords: [number, number][] = route.geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng]
          );
          const prunedCoords = skipSpurPruning
            ? rawCoords
            : eliminateSpursAndInAndOuts(rawCoords, false);
          const cleanCoords = minimizeMicroTurns(prunedCoords, false);
          const distKm = calculateTotalDistanceKm(cleanCoords);

          let hasProhibitedRamps = false;
          let hasUnpavedTrail = false;
          let hasAirportProximity = false;
          let hasHighSpeedRoad = false;
          const detectedSafeCrossings: SafeCrossing[] = [];

          const unpavedStepKeywords = [
            'unpaved',
            'dirt track',
            'dirt road',
            'singletrack',
            'nature trail',
            'hiking trail',
            'mtb',
            'gravel track',
            'gravel path',
            'earth path',
          ];

          for (const leg of route.legs || []) {
            for (const step of leg.steps || []) {
              if (isProhibitedFreewayOrRamp(step)) {
                hasProhibitedRamps = true;
              }

              if (isAirportInfrastructure(undefined, step.name, step.ref)) {
                hasAirportProximity = true;
              }

              // Speed limit on all roads <= 30mph: reject if road is a known arterial/highway
              if (isRoadSpeedLimitOver30(undefined, step.name)) {
                hasHighSpeedRoad = true;
              }

              // Road bike mandate: strictly reject any route that uses an unpaved trail
              if (activity === 'road_bike') {
                const sName = (step.name || '').toLowerCase();
                const sRef = (step.ref || '').toLowerCase();
                if (unpavedStepKeywords.some((kw) => sName.includes(kw) || sRef.includes(kw))) {
                  hasUnpavedTrail = true;
                }
                if (/\b(trail|track|gulch|singletrack|dirt|unpaved|gravel|earth)\b/i.test(sName)) {
                  if (!/\b(greenway|paved|cycleway|bike lane)\b/i.test(sName)) {
                    hasUnpavedTrail = true;
                  }
                }
              }

              if (isMajorArterialRoad(step.name) && step.intersections) {
                for (const inter of step.intersections) {
                  const interLat = inter.location[1];
                  const interLng = inter.location[0];

                  // Check proximity against verified safe crossing nodes
                  const match = safeCrossingNodes.find(
                    (sc) => calculateDistanceMeters([interLat, interLng], [sc.lat, sc.lng]) <= 55
                  );

                  if (match) {
                    const exists = detectedSafeCrossings.some(
                      (c) => calculateDistanceMeters([interLat, interLng], [c.lat, c.lng]) <= 25
                    );
                    if (!exists) {
                      detectedSafeCrossings.push({
                        lat: match.lat,
                        lng: match.lng,
                        type: match.type,
                        name: match.name || `${step.name} Controlled Crossing`,
                        roadName: step.name,
                      });
                    }
                  } else if (inter.bearings && inter.bearings.length >= 3) {
                    const exists = detectedSafeCrossings.some(
                      (c) => calculateDistanceMeters([interLat, interLng], [c.lat, c.lng]) <= 25
                    );
                    if (!exists) {
                      detectedSafeCrossings.push({
                        lat: interLat,
                        lng: interLng,
                        type: 'traffic_signals',
                        name: `${step.name} Signalized Junction`,
                        roadName: step.name,
                      });
                    }
                  }
                }
              }
            }
          }

          // Coordinate-level airport and unpaved trail checks
          const startPt = waypoints[0];
          const airportKey = `${startPt[0].toFixed(2)}_${startPt[1].toFixed(2)}`;
          const airports = airportCache.get(airportKey) || [];
          if (airports.some((az) => cleanCoords.some((c) => calculateDistanceMeters(c, [az.lat, az.lng]) <= az.radiusM))) {
            hasAirportProximity = true;
          }

          if (activity === 'road_bike') {
            const trails = unpavedTrailCache.get(airportKey) || [];
            if (trails.length > 0) {
              for (const trailPt of trails) {
                if (cleanCoords.some((c) => calculateDistanceMeters(c, trailPt) <= 65)) {
                  hasUnpavedTrail = true;
                  break;
                }
              }
            }
          }

          if (hasUnpavedTrail && activity === 'road_bike') {
            // Discard unpaved candidate for road bike and try next paved routing endpoint
            continue;
          }

          if (hasAirportProximity || hasHighSpeedRoad) {
            // Discard route that approaches airports or high-speed arterial roads
            continue;
          }

          return {
            coordinates: cleanCoords,
            distanceKm: distKm,
            safeCrossings: detectedSafeCrossings,
            hasProhibitedRamps,
            hasAirportProximity,
            hasHighSpeedRoad,
            hasUnpavedTrail,
          };
        }
      }
    } catch {
      // try next mirror
    }
  }

  return null;
}

/**
 * Helper to snap an arbitrary coordinate to the nearest real OpenStreetMap road node
 */
export async function snapPointToNearestRoad(
  lat: number,
  lng: number,
  activity: ActivityType = 'run',
  preferRoadLayout: boolean = false
): Promise<[number, number]> {
  // Prefer paved road centerlines ('driving') rather than sidewalks ('foot') for road/run/GPS-art routes
  const profile =
    preferRoadLayout || activity === 'road_bike' || activity === 'run' || activity === 'bike'
      ? 'driving'
      : activity === 'mountain_bike'
      ? 'bike'
      : 'foot';
  const url = `https://router.project-osrm.org/nearest/v1/${profile}/${lng.toFixed(6)},${lat.toFixed(6)}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok' && data.waypoints && data.waypoints.length > 0) {
        const loc = data.waypoints[0].location;
        return [loc[1], loc[0]];
      }
    }
  } catch {
    // fallback to original
  }
  return [lat, lng];
}

/**
 * Snap a multi-waypoint sequence onto real streets with continuous, unbroken road geometry.
 * Never cuts across buildings, houses, or off-road blocks.
 */
export async function snapWaypointsToRealRoads(
  waypoints: [number, number][],
  activity: ActivityType,
  apiConfig?: ApiConfiguration,
  allowUTurns: boolean = false,
  preferRoadLayout: boolean = false
): Promise<{ coordinates: [number, number][]; distanceKm: number }> {
  if (waypoints.length < 2) {
    return { coordinates: waypoints, distanceKm: 0 };
  }

  // 1. Deduplicate consecutive waypoints that are excessively close (< 3m)
  const cleanWaypoints: [number, number][] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = cleanWaypoints[cleanWaypoints.length - 1];
    const curr = waypoints[i];
    if (calculateDistanceMeters(prev, curr) >= 3.0) {
      cleanWaypoints.push(curr);
    }
  }

  if (cleanWaypoints.length < 2) {
    return { coordinates: cleanWaypoints, distanceKm: 0 };
  }

  // 2. Primary Strategy: Route the entire sequence in ONE seamless OSRM/ORS call
  // OSRM easily handles up to 100 waypoints in a single query and guarantees unbroken road paths
  if (cleanWaypoints.length <= 100) {
    const fullRoadResult = await fetchRealRoadPath(cleanWaypoints, activity, apiConfig, true, allowUTurns, [], preferRoadLayout);
    if (fullRoadResult && fullRoadResult.coordinates.length >= 2) {
      return fullRoadResult;
    }
  }

  // 3. Batched Strategy: Divide into larger overlapping chunks of 10-12 waypoints
  const chunkSize = 10;
  const allCoords: [number, number][] = [];

  for (let i = 0; i < cleanWaypoints.length - 1; i += chunkSize - 1) {
    const chunk = cleanWaypoints.slice(i, Math.min(cleanWaypoints.length, i + chunkSize));
    if (chunk.length < 2) break;

    let roadResult = await fetchRealRoadPath(chunk, activity, apiConfig, true, allowUTurns, [], preferRoadLayout);

    // If chunk failed, attempt point-to-point sub-segment routing on real streets
    if (!roadResult || roadResult.coordinates.length < 2) {
      const subCoords: [number, number][] = [];
      for (let j = 0; j < chunk.length - 1; j++) {
        const segPair = [chunk[j], chunk[j + 1]];
        let segResult = await fetchRealRoadPath(segPair, activity, apiConfig, true, allowUTurns, [], preferRoadLayout);

        // If direct pair failed, snap both points to nearest OSM road node first
        if (!segResult || segResult.coordinates.length < 2) {
          const snappedA = await snapPointToNearestRoad(chunk[j][0], chunk[j][1], activity, preferRoadLayout);
          const snappedB = await snapPointToNearestRoad(chunk[j + 1][0], chunk[j + 1][1], activity, preferRoadLayout);
          segResult = await fetchRealRoadPath([snappedA, snappedB], activity, apiConfig, true, allowUTurns, [], preferRoadLayout);
        }

        if (segResult && segResult.coordinates.length >= 2) {
          if (subCoords.length > 0) {
            subCoords.push(...segResult.coordinates.slice(1));
          } else {
            subCoords.push(...segResult.coordinates);
          }
        }
      }

      if (subCoords.length >= 2) {
        roadResult = {
          coordinates: subCoords,
          distanceKm: calculateTotalDistanceKm(subCoords),
          safeCrossings: [],
          hasProhibitedRamps: false,
        };
      }
    }

    if (roadResult && roadResult.coordinates.length >= 2) {
      if (allCoords.length > 0) {
        allCoords.push(...roadResult.coordinates.slice(1));
      } else {
        allCoords.push(...roadResult.coordinates);
      }
    }
  }

  if (allCoords.length >= 2) {
    const distKm = calculateTotalDistanceKm(allCoords);
    return { coordinates: allCoords, distanceKm: distKm };
  }

  // If network routing was completely unavailable, snap all waypoints to nearest streets
  const fallbackSnapped: [number, number][] = [];
  for (const pt of cleanWaypoints) {
    const snappedPt = await snapPointToNearestRoad(pt[0], pt[1], activity, preferRoadLayout);
    fallbackSnapped.push(snappedPt);
  }

  const distKm = calculateTotalDistanceKm(fallbackSnapped);
  return { coordinates: fallbackSnapped, distanceKm: distKm };
}

/**
 * Strict Distance Enforcement Helper:
 * Calibrates the final coordinate path without creating straight line jumps across buildings.
 */
export function enforceDistanceTolerance(
  coordinates: [number, number][],
  targetDistanceKm: number,
  tolerancePercent: number = 0.05
): [number, number][] {
  if (coordinates.length < 4) return coordinates;

  const currentDistKm = calculateTotalDistanceKm(coordinates);
  const minAllowed = targetDistanceKm * (1 - tolerancePercent);
  const maxAllowed = targetDistanceKm * (1 + tolerancePercent);

  // Check if this route is a closed circuit (loop or out-and-back)
  const startPoint = coordinates[0];
  const endPoint = coordinates[coordinates.length - 1];
  const isClosedCircuit = calculateDistanceMeters(startPoint, endPoint) <= 50;

  // If already close or if it's a closed circuit within allowed tolerance, preserve continuous road geometry
  if (currentDistKm >= minAllowed && currentDistKm <= maxAllowed) {
    return coordinates;
  }
  if (isClosedCircuit && Math.abs(currentDistKm - targetDistanceKm) / targetDistanceKm <= tolerancePercent) {
    return coordinates;
  }

  // If route is an open path and longer than target, cleanly trim along the street path
  if (currentDistKm > maxAllowed && !isClosedCircuit) {
    const targetCutM = targetDistanceKm * 1000;
    const trimmed: [number, number][] = [coordinates[0]];
    let accumulatedM = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const stepM = calculateDistanceMeters(coordinates[i], coordinates[i + 1]);
      if (accumulatedM + stepM >= targetCutM) {
        const remainingM = targetCutM - accumulatedM;
        const fraction = stepM > 0 ? remainingM / stepM : 0;
        const endLat = coordinates[i][0] + (coordinates[i + 1][0] - coordinates[i][0]) * fraction;
        const endLng = coordinates[i][1] + (coordinates[i + 1][1] - coordinates[i][1]) * fraction;
        trimmed.push([endLat, endLng]);
        return trimmed;
      }
      accumulatedM += stepM;
      trimmed.push(coordinates[i + 1]);
    }
    return trimmed;
  }

  return coordinates;
}

/**
 * Generate authentic road-snapped GPS Art:
 * Starts ideally at or near the location marker, optimizing the starting/ending anchor
 * to the best nearby road intersection for clean, crisp, distortion-free art lines.
 */
export async function generateRoadGpsArtRoute(
  start: LatLng,
  text: string,
  targetDistanceKm: number,
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<{ coordinates: [number, number][]; confidenceScore: number }> {
  const clean = text.trim().toUpperCase() || 'RUN';
  const knownShapes = [
    'HEART',
    'STAR',
    'PACMAN',
    'TREE',
    'DIAMOND',
    'CROWN',
    'LIGHTNING',
    'SMILE',
    'FLOWER',
    'CAT',
    'DOG',
    'HOUSE',
    'ARROW',
  ];
  const isSpecialShape = knownShapes.includes(clean);
  const tokens = isSpecialShape ? [clean] : clean.replace(/[^A-Z0-9 ]/g, '').split('');
  if (tokens.length === 0) tokens.push('R', 'U', 'N');

  // Discover nearby street intersections/nodes within 350m to anchor the art cleanly
  const nearbyCorridors = await discoverCorridorNodes(start, 0.35, activity);
  let anchorStart = { ...start };

  if (nearbyCorridors.length > 0) {
    let closestNode = nearbyCorridors[0];
    let minD = calculateDistanceMeters([start.lat, start.lng], [closestNode.lat, closestNode.lng]);

    for (let i = 1; i < nearbyCorridors.length; i++) {
      const d = calculateDistanceMeters(
        [start.lat, start.lng],
        [nearbyCorridors[i].lat, nearbyCorridors[i].lng]
      );
      if (d < minD && d >= 20) {
        minD = d;
        closestNode = nearbyCorridors[i];
      }
    }

    // If an optimal road intersection was found within 350m, anchor the art start there
    if (minD <= 350) {
      anchorStart = { lat: closestNode.lat, lng: closestNode.lng };
    }
  }

  const latRad = (anchorStart.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Determine natural readable scale based on requested distance
  const charWidthRatio = isSpecialShape ? 1.15 : 0.75;
  const heightRatio = 1.0;
  const spacingRatio = 0.25;

  let baseGeometricLength = 0;
  let lastPt: [number, number] | null = null;
  tokens.forEach((char, idx) => {
    const glyphPoints = CONTINUOUS_GLYPHS[char] || CONTINUOUS_GLYPHS['O'] || CONTINUOUS_GLYPHS['RUN'];
    const leftX = idx * (charWidthRatio + spacingRatio);
    const mappedPoints = glyphPoints.map(([x, y]) => [leftX + x * charWidthRatio, y * heightRatio] as [number, number]);
    for (let i = 0; i < mappedPoints.length; i++) {
      if (lastPt) {
        baseGeometricLength += Math.hypot(mappedPoints[i][0] - lastPt[0], mappedPoints[i][1] - lastPt[1]);
      }
      lastPt = mappedPoints[i];
    }
  });

  // Calculate box height to match the target distance exactly
  // If base length is 0 (shouldn't happen), default to 0.5km
  // We apply an initial 0.7x factor because real-road routing typically adds 30-40% overhead
  const initialScale = (baseGeometricLength > 0 ? targetDistanceKm / baseGeometricLength : 0.5) * 0.75;
  
  async function generateAtScale(scale: number): Promise<{coords: [number, number][], routedDist: number}> {
    const charWidthKm = charWidthRatio * scale;
    const spacingKm = spacingRatio * scale;
    const heightDeg = scale / kmPerLat;
    const charWidthDeg = charWidthKm / kmPerLng;
    const spacingDeg = spacingKm / kmPerLng;

    const waypoints: [number, number][] = [];
    const bottomLat = anchorStart.lat - heightDeg;

    tokens.forEach((char, idx) => {
      const glyphPoints = CONTINUOUS_GLYPHS[char] || CONTINUOUS_GLYPHS['O'] || CONTINUOUS_GLYPHS['RUN'];
      const leftLng = anchorStart.lng + idx * (charWidthDeg + spacingDeg);

      const mappedPoints: [number, number][] = glyphPoints.map(([x, y]) => {
        const ptLat = bottomLat + y * heightDeg;
        const ptLng = leftLng + x * charWidthDeg;
        return [ptLat, ptLng];
      });

      waypoints.push(...mappedPoints);
    });
    
    try {
      // allowUTurns = true is critical here: drawing text often requires U-turns to trace lines backward
      // preferRoadLayout = true ensures GPS Art always snaps to clean street centerlines rather than sidewalks
      const snapped = await snapWaypointsToRealRoads(waypoints, activity, apiConfig, true, true);
      if (snapped && snapped.coordinates.length > 5) {
        return { coords: snapped.coordinates, routedDist: snapped.distanceKm };
      }
    } catch (e) {
      console.warn("GPS Art OSRM snap failed:", e);
    }
    
    const fallbackDist = calculateTotalDistanceKm(waypoints);
    return { coords: waypoints, routedDist: fallbackDist };
  }

  // Binary search for the perfect scale
  let lowScale = 0.05; // 50m minimum
  let highScale = initialScale * 2.0;
  let currentScale = initialScale;
  let result = await generateAtScale(currentScale);
  let passes = 1;
  let bestResult = result;
  let bestDiff = Math.abs(result.routedDist - targetDistanceKm);

  // Correction loop (up to 6 passes for binary search)
  while (passes <= 6 && bestDiff > targetDistanceKm * 0.15) {
    if (result.routedDist > targetDistanceKm) {
      highScale = currentScale;
    } else if (result.routedDist > 0) {
      lowScale = currentScale;
    }

    currentScale = (lowScale + highScale) / 2.0;
    
    const nextResult = await generateAtScale(currentScale);
    if (nextResult.coords.length > 0) {
      result = nextResult;
      const diff = Math.abs(result.routedDist - targetDistanceKm);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestResult = result;
      }
    } else {
      break;
    }
    passes++;
  }

  let confidenceScore = Math.max(75, Math.min(95, Math.round(100 - tokens.length * 2.5)));

  return {
    coordinates: bestResult.coords,
    confidenceScore,
  };
}

/**
 * Generate radial guide waypoints for a loop, biasing through discovered corridors
 * according to user activity preferences:
 * - Running: roads to greenways/parks/sidewalks, staying on them, then quiet roads.
 * - Road Bike: designated bike lanes, paved greenways, low-stress roads.
 * - Mountain Bike: roads to trails, staying on trails, then roads.
 */
function createLoopWaypoints(
  start: LatLng,
  radiusKm: number,
  numPoints: number = 4,
  corridors: CorridorNode[] = [],
  safeCrossings: SafeCrossingNode[] = [],
  activity: ActivityType = 'run'
): [number, number][] {
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Steer loop center towards preferred corridor clusters if available
  let centerBearing = Math.random() * 2 * Math.PI;
  if (corridors.length > 0) {
    let preferredPool: CorridorNode[] = [];
    if (activity === 'mountain_bike') {
      const mtbNodes = corridors.filter((c) => c.type === 'mtb_trail');
      const gravelNodes = corridors.filter((c) => c.type === 'gravel_path');
      preferredPool = mtbNodes.length > 0 ? mtbNodes : gravelNodes;
    } else if (activity === 'road_bike' || activity === 'bike') {
      preferredPool = corridors.filter(
        (c) =>
          (c.type === 'bike_lane' || c.type === 'greenway') &&
          c.surface !== 'unpaved' &&
          c.surface !== 'dirt' &&
          c.surface !== 'gravel' &&
          c.surface !== 'compacted' &&
          c.surface !== 'fine_gravel'
      );
      if (preferredPool.length === 0) {
        preferredPool = corridors.filter((c) => c.type === 'quiet_street');
      }
    } else if (activity === 'run') {
      const tier1 = corridors.filter((c) => c.type === 'park' || c.type === 'greenway');
      preferredPool = tier1.length > 0 ? tier1 : corridors.filter((c) => c.type === 'quiet_street');
    } else if (activity === 'hike') {
      preferredPool = corridors.filter((c) => c.type === 'trail');
    }

    const pool = preferredPool.length > 0 ? preferredPool : corridors;
    // Calculate centroid of pool to robustly steer towards cluster rather than a random single point
    const sumLat = pool.reduce((acc, c) => acc + c.lat, 0);
    const sumLng = pool.reduce((acc, c) => acc + c.lng, 0);
    const centroidLat = sumLat / pool.length;
    const centroidLng = sumLng / pool.length;
    centerBearing = Math.atan2(centroidLat - start.lat, (centroidLng - start.lng) * Math.cos(latRad));
  }

  // Airport avoidance: check if centerBearing points towards an airport zone, rotate away if so
  const airportKey = `${start.lat.toFixed(2)}_${start.lng.toFixed(2)}`;
  const airports = airportCache.get(airportKey) || [];
  for (const az of airports) {
    const dLat = az.lat - start.lat;
    const dLng = (az.lng - start.lng) * Math.cos(latRad);
    const airportBearing = Math.atan2(dLat, dLng);
    const delta = Math.abs(calculateAngleDelta((centerBearing * 180) / Math.PI, (airportBearing * 180) / Math.PI));
    if (delta < 55) {
      // Rotate 180 degrees away from the airport
      centerBearing = (centerBearing + Math.PI) % (2 * Math.PI);
    }
  }

  const centerLat = start.lat + (radiusKm / kmPerLat) * Math.sin(centerBearing);
  const centerLng = start.lng + (radiusKm / kmPerLng) * Math.cos(centerBearing);

  const startAngle = Math.atan2(start.lat - centerLat, (start.lng - centerLng) * Math.cos(latRad));
  const waypoints: [number, number][] = [[start.lat, start.lng]];
  const dir = Math.random() > 0.5 ? 1 : -1;

  for (let i = 1; i < numPoints; i++) {
    const fraction = i / numPoints;
    const targetAngle = startAngle + dir * fraction * 2 * Math.PI;
    const r = radiusKm * (0.95 + Math.random() * 0.1);

    const theoreticalLat = centerLat + (r / kmPerLat) * Math.sin(targetAngle);
    const theoreticalLng = centerLng + (r / kmPerLng) * Math.cos(targetAngle);

    // 1. If safe crossing exists near the theoretical point, anchor to it!
    if (safeCrossings.length > 0) {
      let closestSafeCrossing: SafeCrossingNode | null = null;
      let minWeightedDist = Infinity;
      for (const sc of safeCrossings) {
        const d = calculateDistanceMeters([theoreticalLat, theoreticalLng], [sc.lat, sc.lng]);
        const tierMultiplier = sc.type === 'traffic_signals' ? 0.7 : sc.type === 'marked_crossing' ? 0.85 : 1.0;
        const weightedDist = d * tierMultiplier;
        if (weightedDist < minWeightedDist && d < radiusKm * 1000 * 0.65) {
          minWeightedDist = weightedDist;
          closestSafeCrossing = sc;
        }
      }
      if (closestSafeCrossing) {
        waypoints.push([closestSafeCrossing.lat, closestSafeCrossing.lng]);
        continue;
      }
    }

    // 2. Activity-sensitive corridor snapping
    if (corridors.length > 0) {
      let closestNode: CorridorNode | null = null;
      let minNodeDist = Infinity;
      const isOutboundConnector = i === 1;
      const isReturnConnector = i === numPoints - 1;
      const isCoreWorkout = !isOutboundConnector && !isReturnConnector;

      for (const node of corridors) {
        // Road bike mandate: never select unpaved trail
        if (activity === 'road_bike' || activity === 'bike') {
          if (
            node.surface === 'unpaved' ||
            node.surface === 'dirt' ||
            node.surface === 'gravel' ||
            node.surface === 'compacted' ||
            node.surface === 'fine_gravel' ||
            node.type === 'trail' ||
            node.type === 'mtb_trail' ||
            node.type === 'gravel_path'
          ) {
            continue;
          }
        }

        const d = calculateDistanceMeters([theoreticalLat, theoreticalLng], [node.lat, node.lng]);
        if (d >= radiusKm * 1000 * 0.6) continue;

        // Weight multiplier (lower is better)
        let weight = 1.0;
        if (activity === 'mountain_bike') {
          if (isCoreWorkout) {
            // Stay strictly on MTB trails and gravel paths during core workout
            weight =
              node.type === 'mtb_trail'
                ? 0.15
                : node.type === 'gravel_path'
                ? 0.3
                : node.type === 'trail'
                ? 0.45
                : 2.5;
          } else {
            // Outbound or return leg: roads to trails, then trails to roads
            weight =
              node.type === 'quiet_street'
                ? 0.5
                : node.type === 'mtb_trail'
                ? 0.6
                : node.type === 'gravel_path'
                ? 0.7
                : 1.0;
          }
        } else if (activity === 'road_bike' || activity === 'bike') {
          weight =
            node.type === 'bike_lane'
              ? 0.25
              : node.type === 'greenway'
              ? 0.35
              : node.type === 'quiet_street'
              ? 0.7
              : 2.0;
        } else if (activity === 'run') {
          if (isCoreWorkout) {
            // Stay on greenways, parks, and calm street layouts (avoid sidewalks)
            weight =
              node.type === 'greenway'
                ? 0.2
                : node.type === 'park'
                ? 0.25
                : node.type === 'quiet_street'
                ? 0.55
                : 2.2;
          } else {
            // Outbound road to park/greenway, or return road to start
            weight =
              node.type === 'quiet_street'
                ? 0.45
                : node.type === 'greenway' || node.type === 'park'
                ? 0.6
                : 1.0;
          }
        }

        const weightedD = d * weight;
        if (weightedD < minNodeDist) {
          minNodeDist = weightedD;
          closestNode = node;
        }
      }

      if (closestNode) {
        waypoints.push([closestNode.lat, closestNode.lng]);
        continue;
      }
    }

    waypoints.push([theoreticalLat, theoreticalLng]);
  }

  waypoints.push([start.lat, start.lng]);
  return waypoints;
}

/**
 * Builds sequential waypoints along a greenway or greenbelt corridor.
 * Prioritizes traveling directly along the greenway path rather than parallel streets.
 */
export function buildGreenwayTraversalWaypoints(
  start: LatLng,
  targetDistanceKm: number,
  corridors: CorridorNode[],
  activity: ActivityType,
  isLoop: boolean
): [number, number][] | null {
  const latRad = (start.lat * Math.PI) / 180;

  // 1. Identify greenway/park nodes
  let gwNodes: CorridorNode[] = [];
  if (activity === 'run') {
    gwNodes = corridors.filter(
      (c) =>
        c.type === 'greenway' ||
        c.type === 'park' ||
        (c.name && /greenbelt|greenway|riverwalk|river path|esplanade/i.test(c.name))
    );
  } else if (activity === 'road_bike' || activity === 'bike') {
    gwNodes = corridors.filter(
      (c) =>
        (c.type === 'greenway' ||
          c.type === 'bike_lane' ||
          (c.name && /greenbelt|greenway|cycleway|bike path/i.test(c.name))) &&
        c.surface !== 'unpaved' &&
        c.surface !== 'dirt' &&
        c.surface !== 'gravel' &&
        c.surface !== 'compacted' &&
        c.surface !== 'fine_gravel'
    );
  }

  if (gwNodes.length < 2) return null;

  // 2. Find closest greenway entry point to start
  let entryNode = gwNodes[0];
  let minEntryDist = calculateDistanceMeters([start.lat, start.lng], [entryNode.lat, entryNode.lng]);
  for (const n of gwNodes) {
    const d = calculateDistanceMeters([start.lat, start.lng], [n.lat, n.lng]);
    if (d < minEntryDist) {
      minEntryDist = d;
      entryNode = n;
    }
  }

  const entryDistKm = minEntryDist / 1000;
  // If greenway is beyond 45% of total route distance, it is too far for this workout
  if (entryDistKm > targetDistanceKm * 0.45) return null;

  // Budget for distance on the greenway
  const greenwayDistBudgetKm = Math.max(
    0.4,
    isLoop ? targetDistanceKm - entryDistKm * 1.5 : (targetDistanceKm - entryDistKm * 2) / 2
  );

  // 3. Find primary direction along greenway nodes
  const otherNodes = gwNodes.filter((n) => n !== entryNode);
  if (otherNodes.length === 0) return null;

  let bestFarNode = otherNodes[0];
  let bestFarDiff = Infinity;
  for (const n of otherNodes) {
    const d = calculateDistanceMeters([entryNode.lat, entryNode.lng], [n.lat, n.lng]) / 1000;
    const diff = Math.abs(d - greenwayDistBudgetKm);
    if (diff < bestFarDiff) {
      bestFarDiff = diff;
      bestFarNode = n;
    }
  }

  const dLat = bestFarNode.lat - entryNode.lat;
  const dLng = (bestFarNode.lng - entryNode.lng) * Math.cos(latRad);
  const flowAngle = Math.atan2(dLat, dLng);

  const pathCandidates = otherNodes
    .map((n) => {
      const nodeDLat = n.lat - entryNode.lat;
      const nodeDLng = (n.lng - entryNode.lng) * Math.cos(latRad);
      const proj = nodeDLat * Math.sin(flowAngle) + nodeDLng * Math.cos(flowAngle);
      const cross = Math.abs(-nodeDLat * Math.cos(flowAngle) + nodeDLng * Math.sin(flowAngle));
      const distFromEntryM = calculateDistanceMeters([entryNode.lat, entryNode.lng], [n.lat, n.lng]);
      return { node: n, projM: proj * 111000, crossM: cross * 111000, distFromEntryM };
    })
    .filter((c) => c.projM > 50 && c.crossM < 800 && c.distFromEntryM <= greenwayDistBudgetKm * 1000 * 1.3)
    .sort((a, b) => a.projM - b.projM);

  const greenwayWaypoints: [number, number][] = [[entryNode.lat, entryNode.lng]];
  let lastM = 0;
  for (const cand of pathCandidates) {
    if (cand.projM - lastM >= 350) {
      greenwayWaypoints.push([cand.node.lat, cand.node.lng]);
      lastM = cand.projM;
    }
  }
  if (greenwayWaypoints.length === 1 && pathCandidates.length > 0) {
    const lastCand = pathCandidates[pathCandidates.length - 1];
    greenwayWaypoints.push([lastCand.node.lat, lastCand.node.lng]);
  }

  if (greenwayWaypoints.length < 2) return null;

  if (!isLoop) {
    return [[start.lat, start.lng], ...greenwayWaypoints];
  }

  // Loop return: find a quiet road or safe crossing that returns back to start without full backtrack
  const lastGwPt = greenwayWaypoints[greenwayWaypoints.length - 1];
  const returnQuietNodes = corridors.filter(
    (c) =>
      (c.type === 'quiet_street' || c.type === 'park' || c.type === 'greenway') &&
      c.surface !== 'unpaved' &&
      c.surface !== 'dirt'
  );

  let returnPoint: [number, number] | null = null;
  let bestReturnScore = Infinity;
  const midLat = (lastGwPt[0] + start.lat) / 2;
  const midLng = (lastGwPt[1] + start.lng) / 2;

  for (const n of returnQuietNodes) {
    const dMid = calculateDistanceMeters([midLat, midLng], [n.lat, n.lng]);
    const dLast = calculateDistanceMeters(lastGwPt, [n.lat, n.lng]);
    const dStart = calculateDistanceMeters([start.lat, start.lng], [n.lat, n.lng]);
    if (dLast > 150 && dStart > 150 && dMid < 1500) {
      const score = dMid;
      if (score < bestReturnScore) {
        bestReturnScore = score;
        returnPoint = [n.lat, n.lng];
      }
    }
  }

  if (returnPoint) {
    return [[start.lat, start.lng], ...greenwayWaypoints, returnPoint, [start.lat, start.lng]];
  }

  return [[start.lat, start.lng], ...greenwayWaypoints, [start.lat, start.lng]];
}

/**
 * Builds waypoints for Mountain Bike loops that stay strictly WITHIN the trail network.
 * Connects road from start to trailhead, loops through trail singletracks, and returns.
 */
export function buildMountainBikeLoopWaypoints(
  start: LatLng,
  targetDistanceKm: number,
  corridors: CorridorNode[]
): [number, number][] | null {
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  const trailNodes = corridors.filter(
    (c) => c.type === 'mtb_trail' || c.type === 'gravel_path' || c.type === 'trail'
  );

  if (trailNodes.length < 3) return null;

  // 1. Find closest trail entrance / trailhead to start
  let entryNode = trailNodes[0];
  let minEntryDist = calculateDistanceMeters([start.lat, start.lng], [entryNode.lat, entryNode.lng]);
  for (const n of trailNodes) {
    const d = calculateDistanceMeters([start.lat, start.lng], [n.lat, n.lng]);
    if (d < minEntryDist) {
      minEntryDist = d;
      entryNode = n;
    }
  }

  const entryDistKm = minEntryDist / 1000;
  const trailBudgetKm = Math.max(0.6, targetDistanceKm - 2 * entryDistKm);

  // 2. Centroid of all trail nodes
  const sumLat = trailNodes.reduce((acc, c) => acc + c.lat, 0);
  const sumLng = trailNodes.reduce((acc, c) => acc + c.lng, 0);
  const centroidLat = sumLat / trailNodes.length;
  const centroidLng = sumLng / trailNodes.length;

  // 3. Loop radius within the trail area
  const loopRadiusKm = Math.min(2.5, Math.max(0.3, trailBudgetKm / (2 * Math.PI * 1.3)));

  // 4. Generate loop waypoints around the trail centroid, snapping strictly to trail nodes
  const baseAngle = Math.atan2(entryNode.lat - centroidLat, (entryNode.lng - centroidLng) * Math.cos(latRad));
  const numTrailPoints = 3;
  const trailWaypoints: [number, number][] = [];

  for (let i = 1; i <= numTrailPoints; i++) {
    const angle = baseAngle + (i * (2 * Math.PI)) / (numTrailPoints + 1);
    const theoreticalLat = centroidLat + (loopRadiusKm / kmPerLat) * Math.sin(angle);
    const theoreticalLng = centroidLng + (loopRadiusKm / kmPerLng) * Math.cos(angle);

    let closestTrailNode: CorridorNode | null = null;
    let minD = Infinity;
    for (const n of trailNodes) {
      const d = calculateDistanceMeters([theoreticalLat, theoreticalLng], [n.lat, n.lng]);
      if (d < minD) {
        minD = d;
        closestTrailNode = n;
      }
    }

    if (closestTrailNode) {
      const isDuplicate = trailWaypoints.some(
        (pt) => calculateDistanceMeters(pt, [closestTrailNode!.lat, closestTrailNode!.lng]) <= 50
      );
      if (!isDuplicate) {
        trailWaypoints.push([closestTrailNode.lat, closestTrailNode.lng]);
      }
    }
  }

  if (trailWaypoints.length < 2) return null;

  if (entryDistKm <= 0.08) {
    return [[start.lat, start.lng], ...trailWaypoints, [start.lat, start.lng]];
  }

  return [
    [start.lat, start.lng],
    [entryNode.lat, entryNode.lng],
    ...trailWaypoints,
    [entryNode.lat, entryNode.lng],
    [start.lat, start.lng],
  ];
}

/**
 * Generate accurate real-road Loop Route with calibrated distance matching
 * (±10% margin for Mountain Bike, ±5% for others), freeway ramp avoidance,
 * technical difficulty flagging (mtb:scale 3+), and graceful gravel fallback.
 */
export async function generateRoadLoopRoute(
  start: LatLng,
  targetDistanceKm: number,
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<{
  coordinates: [number, number][];
  safeCrossings: SafeCrossing[];
  technicalWarnings?: TechnicalSegmentWarning[];
  gravelFallbackUsed?: boolean;
}> {
  let radiusKm = targetDistanceKm / (2 * Math.PI * 1.35);

  // Discover corridors tailored to activity
  const corridors = await discoverCorridorNodes(start, radiusKm * 1.3, activity);
  // Discover controlled intersections with lights or stop signs
  const safeCrossings = await discoverSafeCrossings(start, radiusKm * 1.4);

  let bestCoords: [number, number][] = [];
  let bestSafeCrossings: SafeCrossing[] = [];
  let bestDistDiff = Infinity;

  // Margin tolerance: 10% for Mountain Bike, 5% for all other activities
  const toleranceMargin = activity === 'mountain_bike' ? 0.10 : 0.05;

  // 1. Mountain Bike: prioritize looping strictly within the trail area
  if (activity === 'mountain_bike') {
    const mtbWaypoints = buildMountainBikeLoopWaypoints(start, targetDistanceKm, corridors);
    if (mtbWaypoints && mtbWaypoints.length >= 4) {
      const result = await fetchRealRoadPath(mtbWaypoints, activity, apiConfig, false, true, []);
      if (result && result.coordinates.length > 5 && !result.hasProhibitedRamps && !result.hasAirportProximity) {
        const cleaned = eliminateSpursAndInAndOuts(result.coordinates, true);
        const dist = calculateTotalDistanceKm(cleaned);
        const diff = Math.abs(dist - targetDistanceKm);
        if (diff / targetDistanceKm <= toleranceMargin * 1.5) {
          bestCoords = cleaned;
          bestDistDiff = diff;
          bestSafeCrossings = result.safeCrossings || [];
        }
      }
    }
  } else if (activity === 'run' || activity === 'road_bike') {
    // Prioritize greenway/greenbelt traversal if available
    const gwWaypoints = buildGreenwayTraversalWaypoints(start, targetDistanceKm, corridors, activity, true);
    if (gwWaypoints && gwWaypoints.length >= 3) {
      const result = await fetchRealRoadPath(gwWaypoints, activity, apiConfig, false, true, safeCrossings);
      if (
        result &&
        result.coordinates.length > 5 &&
        !result.hasProhibitedRamps &&
        !result.hasAirportProximity &&
        !result.hasHighSpeedRoad &&
        !(activity === 'road_bike' && result.hasUnpavedTrail)
      ) {
        const cleaned = eliminateSpursAndInAndOuts(result.coordinates, true);
        const dist = calculateTotalDistanceKm(cleaned);
        const diff = Math.abs(dist - targetDistanceKm);
        if (diff / targetDistanceKm <= toleranceMargin * 1.5) {
          bestCoords = cleaned;
          bestDistDiff = diff;
          bestSafeCrossings = result.safeCrossings || [];
        }
      }
    }
  }

  // For hike in purely paved areas with zero trail corridors, route along road layout instead of sidewalks
  const preferRoadLayout =
    activity !== 'hike' || !corridors.some((c) => c.type === 'trail');

  // 2. Calibration loop if not satisfied by preferred corridor traversal
  if (bestCoords.length === 0 || bestDistDiff / targetDistanceKm > toleranceMargin) {
    for (let pass = 1; pass <= 4; pass++) {
      const activeCrossings = pass <= 2 ? safeCrossings : [];
      const rawWaypoints = createLoopWaypoints(start, radiusKm, 4, corridors, activeCrossings, activity);
      // Pre-snap guide waypoints to verified OpenStreetMap road centerlines
      const waypoints: [number, number][] = [rawWaypoints[0]];
      for (let w = 1; w < rawWaypoints.length - 1; w++) {
        const pt = rawWaypoints[w];
        const isMtbTrailPt =
          activity === 'mountain_bike' &&
          corridors.some(
            (c) =>
              (c.type === 'mtb_trail' || c.type === 'gravel_path' || c.type === 'trail') &&
              calculateDistanceMeters(pt, [c.lat, c.lng]) <= 45
          );
        if (isMtbTrailPt) {
          waypoints.push(pt);
        } else {
          const snapped = await snapPointToNearestRoad(pt[0], pt[1], activity, preferRoadLayout);
          waypoints.push(snapped);
        }
      }
      waypoints.push(rawWaypoints[rawWaypoints.length - 1]);

      const result = await fetchRealRoadPath(waypoints, activity, apiConfig, false, false, activeCrossings, preferRoadLayout);

      if (result && result.coordinates.length > 5) {
        if (
          result.hasProhibitedRamps ||
          result.hasAirportProximity ||
          result.hasHighSpeedRoad ||
          (activity === 'road_bike' && result.hasUnpavedTrail)
        ) {
          radiusKm *= 0.85;
          continue;
        }

        const cleaned = eliminateSpursAndInAndOuts(result.coordinates, true);
        const dist = calculateTotalDistanceKm(cleaned);
        const diff = Math.abs(dist - targetDistanceKm);

        if (diff < bestDistDiff) {
          bestDistDiff = diff;
          bestCoords = cleaned;
          bestSafeCrossings = result.safeCrossings || [];
        }

        if (diff / targetDistanceKm <= toleranceMargin) {
          break;
        }

        const ratio = targetDistanceKm / Math.max(0.1, dist);
        radiusKm = Math.max(0.15, radiusKm * Math.sqrt(ratio));
      }
    }
  }

  // Fallback if no valid road route was generated: GUARANTEED REAL-ROAD ROUTING, NEVER STRAIGHT LINES
  if (bestCoords.length === 0) {
    const fallbackRadius = Math.max(0.35, targetDistanceKm / (2 * Math.PI * 1.3));
    const rawFbPointers = createLoopWaypoints(start, fallbackRadius, 4, corridors, [], activity);
    const fbWaypoints: [number, number][] = [rawFbPointers[0]];
    for (let w = 1; w < rawFbPointers.length - 1; w++) {
      const snapped = await snapPointToNearestRoad(rawFbPointers[w][0], rawFbPointers[w][1], activity, preferRoadLayout);
      fbWaypoints.push(snapped);
    }
    fbWaypoints.push(rawFbPointers[rawFbPointers.length - 1]);

    const fbResult = await fetchRealRoadPath(fbWaypoints, activity, apiConfig, false, true, [], preferRoadLayout);
    if (fbResult && fbResult.coordinates.length > 2) {
      bestCoords = eliminateSpursAndInAndOuts(fbResult.coordinates, true);
    } else {
      // Fallback out-and-back along nearest verified road
      const snappedStart = await snapPointToNearestRoad(start.lat, start.lng, activity, preferRoadLayout);
      const halfKm = targetDistanceKm / 2;
      const testPt = await snapPointToNearestRoad(
        start.lat + (halfKm / 111) * 0.7,
        start.lng + (halfKm / (111 * Math.cos((start.lat * Math.PI) / 180))) * 0.7,
        activity,
        preferRoadLayout
      );
      const directRoad = await fetchRealRoadPath([snappedStart, testPt], activity, apiConfig, false, true, [], preferRoadLayout);
      if (directRoad && directRoad.coordinates.length > 1) {
        bestCoords = [...directRoad.coordinates, ...[...directRoad.coordinates].reverse().slice(1)];
      }
    }
  }

  const smoothedCoords = minimizeMicroTurns(bestCoords, true);
  const finalCoords = enforceDistanceTolerance(smoothedCoords, targetDistanceKm, toleranceMargin);

  // Technical difficulty flagging (mtb:scale 3+) on route
  const technicalWarnings: TechnicalSegmentWarning[] = [];
  if (activity === 'mountain_bike') {
    for (const c of corridors) {
      if (c.mtbScale && c.mtbScale >= 3) {
        const isNear = finalCoords.some(
          ([rLat, rLng]) => calculateDistanceMeters([rLat, rLng], [c.lat, c.lng]) <= 250
        );
        if (isNear) {
          const exists = technicalWarnings.some(
            (tw) => calculateDistanceMeters([tw.lat, tw.lng], [c.lat, c.lng]) <= 50
          );
          if (!exists) {
            technicalWarnings.push({
              lat: c.lat,
              lng: c.lng,
              mtbScale: c.mtbScale,
              name: c.name || 'Severe Technical Singletrack',
              description: `Singletrail Scale S${c.mtbScale}+ (extreme obstacles, large rock gardens, steep drop-offs >40% grade). Requires advanced bike handling skills.`,
            });
          }
        }
      }
    }
  }

  const gravelFallbackUsed =
    activity === 'mountain_bike' &&
    corridors.some((c) => c.type === 'gravel_path') &&
    !corridors.some((c) => c.type === 'mtb_trail');

  return {
    coordinates: finalCoords,
    safeCrossings: bestSafeCrossings,
    technicalWarnings: technicalWarnings.length > 0 ? technicalWarnings : undefined,
    gravelFallbackUsed: gravelFallbackUsed || undefined,
  };
}

/**
 * Generate accurate real-road Out-and-Back Route strictly matching target within 5%,
 * avoiding high-speed freeway ramps, funneling crossings through traffic signals,
 * and falling back to regular mapping if needed.
 */
export async function generateRoadOutAndBackRoute(
  start: LatLng,
  targetDistanceKm: number,
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<{
  coordinates: [number, number][];
  safeCrossings: SafeCrossing[];
  technicalWarnings?: TechnicalSegmentWarning[];
  gravelFallbackUsed?: boolean;
}> {
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  const halfTargetKm = targetDistanceKm / 2;

  // Discover greenways/parks for run, or trails for hike
  const corridors = await discoverCorridorNodes(start, halfTargetKm * 1.3, activity);
  // Discover controlled intersections with lights or stop signs
  const safeCrossings = await discoverSafeCrossings(start, halfTargetKm * 1.4);

  // Margin tolerance: 10% for Mountain Bike, 5% for other activities
  const toleranceMargin = activity === 'mountain_bike' ? 0.10 : 0.05;

  let bearing = Math.random() * 2 * Math.PI;
  // If corridors exist, steer bearing towards the preferred cluster centroid
  if (corridors.length > 0) {
    let preferredPool: CorridorNode[] = [];
    if (activity === 'mountain_bike') {
      const mtbNodes = corridors.filter((c) => c.type === 'mtb_trail');
      const gravelNodes = corridors.filter((c) => c.type === 'gravel_path');
      preferredPool = mtbNodes.length > 0 ? mtbNodes : gravelNodes;
    } else if (activity === 'road_bike' || activity === 'bike') {
      preferredPool = corridors.filter(
        (c) =>
          (c.type === 'bike_lane' || c.type === 'greenway') &&
          c.surface !== 'unpaved' &&
          c.surface !== 'dirt' &&
          c.surface !== 'gravel' &&
          c.surface !== 'compacted' &&
          c.surface !== 'fine_gravel'
      );
      if (preferredPool.length === 0) {
        preferredPool = corridors.filter((c) => c.type === 'quiet_street');
      }
    } else if (activity === 'run') {
      const tier1 = corridors.filter((c) => c.type === 'park' || c.type === 'greenway');
      preferredPool = tier1.length > 0 ? tier1 : corridors.filter((c) => c.type === 'quiet_street');
    } else if (activity === 'hike') {
      preferredPool = corridors.filter((c) => c.type === 'trail');
    }
    const pool = preferredPool.length > 0 ? preferredPool : corridors;
    const sumLat = pool.reduce((acc, c) => acc + c.lat, 0);
    const sumLng = pool.reduce((acc, c) => acc + c.lng, 0);
    const centroidLat = sumLat / pool.length;
    const centroidLng = sumLng / pool.length;
    bearing = Math.atan2(centroidLat - start.lat, (centroidLng - start.lng) * Math.cos(latRad));
  } else if (safeCrossings.length > 0) {
    // Steer towards tier 1 traffic signals if available
    const signalsOnly = safeCrossings.filter((s) => s.type === 'traffic_signals');
    const pool = signalsOnly.length > 0 ? signalsOnly : safeCrossings;
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const dLat = candidate.lat - start.lat;
    const dLng = (candidate.lng - start.lng) * Math.cos(latRad);
    bearing = Math.atan2(dLat, dLng);
  }

  // Airport avoidance: check if bearing points towards an airport zone, rotate away if so
  const airportKey = `${start.lat.toFixed(2)}_${start.lng.toFixed(2)}`;
  const airports = airportCache.get(airportKey) || [];
  for (const az of airports) {
    const dLat = az.lat - start.lat;
    const dLng = (az.lng - start.lng) * Math.cos(latRad);
    const airportBearing = Math.atan2(dLat, dLng);
    const delta = Math.abs(calculateAngleDelta((bearing * 180) / Math.PI, (airportBearing * 180) / Math.PI));
    if (delta < 55) {
      // Rotate 180 degrees away from the airport
      bearing = (bearing + Math.PI) % (2 * Math.PI);
    }
  }

  let bestCoords: [number, number][] = [];
  let bestSafeCrossings: SafeCrossing[] = [];
  let bestDiff = Infinity;

  const preferRoadLayout =
    activity !== 'hike' || !corridors.some((c) => c.type === 'trail');

  // 1. Prioritize greenway / greenbelt out-and-back traversal for running and road bike
  if (activity === 'run' || activity === 'road_bike') {
    const gwWaypoints = buildGreenwayTraversalWaypoints(start, targetDistanceKm, corridors, activity, false);
    if (gwWaypoints && gwWaypoints.length >= 2) {
      const outResult = await fetchRealRoadPath(gwWaypoints, activity, apiConfig, false, true, safeCrossings);
      if (
        outResult &&
        outResult.coordinates.length > 2 &&
        !outResult.hasProhibitedRamps &&
        !outResult.hasAirportProximity &&
        !outResult.hasHighSpeedRoad &&
        !(activity === 'road_bike' && outResult.hasUnpavedTrail)
      ) {
        const cleanOutbound = eliminateSpursAndInAndOuts(outResult.coordinates, false);
        const targetHalfM = halfTargetKm * 1000;
        const outboundLeg: [number, number][] = [cleanOutbound[0]];
        let accumulatedM = 0;

        for (let i = 0; i < cleanOutbound.length - 1; i++) {
          const stepM = calculateDistanceMeters(cleanOutbound[i], cleanOutbound[i + 1]);
          if (accumulatedM + stepM >= targetHalfM) {
            const remainingM = targetHalfM - accumulatedM;
            const fraction = stepM > 0 ? remainingM / stepM : 0;
            const turnLat = cleanOutbound[i][0] + (cleanOutbound[i + 1][0] - cleanOutbound[i][0]) * fraction;
            const turnLng = cleanOutbound[i][1] + (cleanOutbound[i + 1][1] - cleanOutbound[i][1]) * fraction;
            outboundLeg.push([turnLat, turnLng]);
            break;
          }
          accumulatedM += stepM;
          outboundLeg.push(cleanOutbound[i + 1]);
        }

        const inboundLeg = [...outboundLeg].reverse();
        const combined: [number, number][] = [...outboundLeg, ...inboundLeg.slice(1)];
        const totalDistKm = calculateTotalDistanceKm(combined);
        const diff = Math.abs(totalDistKm - targetDistanceKm);

        if (diff / targetDistanceKm <= toleranceMargin * 1.5) {
          bestCoords = combined;
          bestDiff = diff;
          bestSafeCrossings = outResult.safeCrossings || [];
        }
      }
    }
  }

  // 2. 4-pass calibration if preferred greenway path is not active or outside tolerance
  if (bestCoords.length === 0 || bestDiff / targetDistanceKm > toleranceMargin) {
    for (let pass = 0; pass < 4; pass++) {
      const currentBearing = bearing + (pass === 0 ? 0 : pass === 1 ? 0.4 : pass === 2 ? -0.4 : 0.8);
      // Probe ahead along the corridor far enough that real road distance reaches halfTargetKm
      const probeStraightKm = (halfTargetKm * 1.35) / 1.25;

      let probeLat = start.lat + (probeStraightKm / kmPerLat) * Math.sin(currentBearing);
      let probeLng = start.lng + (probeStraightKm / kmPerLng) * Math.cos(currentBearing);

      // Passes 0-1: Try snapping to safe crossing or corridor
      // Passes 2-3: Fallback to regular mapping from previous versions
      if (pass <= 1 && safeCrossings.length > 0) {
        let closestCrossing: SafeCrossingNode | null = null;
        let minWeightedD = Infinity;
        for (const sc of safeCrossings) {
          const d = calculateDistanceMeters([probeLat, probeLng], [sc.lat, sc.lng]);
          const tierMultiplier = sc.type === 'traffic_signals' ? 0.7 : 1.0;
          const weightedD = d * tierMultiplier;
          if (weightedD < minWeightedD && d < probeStraightKm * 1000 * 0.6) {
            minWeightedD = weightedD;
            closestCrossing = sc;
          }
        }
        if (closestCrossing) {
          probeLat = closestCrossing.lat;
          probeLng = closestCrossing.lng;
        }
      } else if (corridors.length > 0) {
        let closestNode: CorridorNode | null = null;
        let minD = Infinity;
        for (const n of corridors) {
          // Road bike mandate: never select unpaved trail
          if (activity === 'road_bike' || activity === 'bike') {
            if (
              n.surface === 'unpaved' ||
              n.surface === 'dirt' ||
              n.surface === 'gravel' ||
              n.surface === 'compacted' ||
              n.surface === 'fine_gravel' ||
              n.type === 'trail' ||
              n.type === 'mtb_trail' ||
              n.type === 'gravel_path'
            ) {
              continue;
            }
          }

          const d = calculateDistanceMeters([probeLat, probeLng], [n.lat, n.lng]);
          if (d >= probeStraightKm * 1000 * 0.6) continue;

          let weight = 1.0;
          if (activity === 'mountain_bike') {
            weight = n.type === 'mtb_trail' ? 0.15 : n.type === 'gravel_path' ? 0.3 : n.type === 'trail' ? 0.45 : 2.5;
          } else if (activity === 'road_bike' || activity === 'bike') {
            weight = n.type === 'bike_lane' ? 0.25 : n.type === 'greenway' ? 0.35 : 1.5;
          } else if (activity === 'run') {
            weight = n.type === 'greenway' ? 0.2 : n.type === 'park' ? 0.25 : n.type === 'quiet_street' ? 0.5 : 2.0;
          }
          const weightedD = d * weight;
          if (weightedD < minD) {
            minD = weightedD;
            closestNode = n;
          }
        }
        if (closestNode) {
          probeLat = closestNode.lat;
          probeLng = closestNode.lng;
        } else {
          const snappedProbe = await snapPointToNearestRoad(probeLat, probeLng, activity, preferRoadLayout);
          probeLat = snappedProbe[0];
          probeLng = snappedProbe[1];
        }
      } else {
        const snappedProbe = await snapPointToNearestRoad(probeLat, probeLng, activity, preferRoadLayout);
        probeLat = snappedProbe[0];
        probeLng = snappedProbe[1];
      }

      const activeSafeCrossings = pass <= 1 ? safeCrossings : [];
      const outResult = await fetchRealRoadPath(
        [[start.lat, start.lng], [probeLat, probeLng]],
        activity,
        apiConfig,
        false,
        false,
        activeSafeCrossings,
        preferRoadLayout
      );

      if (outResult && outResult.coordinates.length > 2) {
        if (
          outResult.hasProhibitedRamps ||
          outResult.hasAirportProximity ||
          outResult.hasHighSpeedRoad ||
          (activity === 'road_bike' && outResult.hasUnpavedTrail)
        ) {
          continue;
        }

        // 1. Clean any spurs or in-and-outs along the outbound path
        const cleanOutbound = eliminateSpursAndInAndOuts(outResult.coordinates, false);

        // 2. Slice outbound road polyline at EXACTLY halfTargetKm to establish on-road turnaround point
        const targetHalfM = halfTargetKm * 1000;
        const outboundLeg: [number, number][] = [cleanOutbound[0]];
        let accumulatedM = 0;

        for (let i = 0; i < cleanOutbound.length - 1; i++) {
          const stepM = calculateDistanceMeters(cleanOutbound[i], cleanOutbound[i + 1]);
          if (accumulatedM + stepM >= targetHalfM) {
            const remainingM = targetHalfM - accumulatedM;
            const fraction = stepM > 0 ? remainingM / stepM : 0;
            const turnLat = cleanOutbound[i][0] + (cleanOutbound[i + 1][0] - cleanOutbound[i][0]) * fraction;
            const turnLng = cleanOutbound[i][1] + (cleanOutbound[i + 1][1] - cleanOutbound[i][1]) * fraction;
            outboundLeg.push([turnLat, turnLng]);
            break;
          }
          accumulatedM += stepM;
          outboundLeg.push(cleanOutbound[i + 1]);
        }

        // 3. Return leg: find closest path/route that will turn around
        const turnaroundPoint = outboundLeg[outboundLeg.length - 1];
        let inboundLeg: [number, number][] = [];

        if (activity === 'mountain_bike') {
          try {
            const returnPathResult = await fetchRealRoadPath(
              [turnaroundPoint, [start.lat, start.lng]],
              activity,
              apiConfig,
              false,
              false,
              activeSafeCrossings
            );
            if (
              returnPathResult &&
              returnPathResult.coordinates.length > 2 &&
              !returnPathResult.hasProhibitedRamps
            ) {
              const cleanReturn = eliminateSpursAndInAndOuts(returnPathResult.coordinates, false);
              if (cleanReturn.length > 1) {
                inboundLeg = cleanReturn;
              }
            }
          } catch {
            // Fall back to centerline reverse if network query fails
          }
        }

        if (inboundLeg.length === 0) {
          inboundLeg = [...outboundLeg].reverse();
        }

        const combined: [number, number][] = [...outboundLeg, ...inboundLeg.slice(1)];
        const totalDistKm = calculateTotalDistanceKm(combined);
        const diff = Math.abs(totalDistKm - targetDistanceKm);

        if (diff < bestDiff) {
          bestDiff = diff;
          bestCoords = combined;
          bestSafeCrossings = outResult.safeCrossings || [];
        }

        // Distance margin check (10% for MTB, 5% for others)
        if (diff / targetDistanceKm <= toleranceMargin) {
          break;
        }
      }
    }
  }

  // Guaranteed real-road fallback: NEVER return straight lines
  if (bestCoords.length === 0) {
    const snappedStart = await snapPointToNearestRoad(start.lat, start.lng, activity, preferRoadLayout);
    const probeTargetKm = halfTargetKm;
    const testPt = await snapPointToNearestRoad(
      start.lat + (probeTargetKm / kmPerLat) * Math.sin(bearing),
      start.lng + (probeTargetKm / kmPerLng) * Math.cos(bearing),
      activity,
      preferRoadLayout
    );
    const directRoad = await fetchRealRoadPath([snappedStart, testPt], activity, apiConfig, false, true, [], preferRoadLayout);
    if (directRoad && directRoad.coordinates.length > 1) {
      bestCoords = [...directRoad.coordinates, ...[...directRoad.coordinates].reverse().slice(1)];
    }
  }

  const smoothedCoords = minimizeMicroTurns(bestCoords, true);
  const finalCoords = enforceDistanceTolerance(smoothedCoords, targetDistanceKm, toleranceMargin);

  // Technical difficulty flagging (mtb:scale 3+) on route
  const technicalWarnings: TechnicalSegmentWarning[] = [];
  if (activity === 'mountain_bike') {
    for (const c of corridors) {
      if (c.mtbScale && c.mtbScale >= 3) {
        const isNear = finalCoords.some(
          ([rLat, rLng]) => calculateDistanceMeters([rLat, rLng], [c.lat, c.lng]) <= 250
        );
        if (isNear) {
          const exists = technicalWarnings.some(
            (tw) => calculateDistanceMeters([tw.lat, tw.lng], [c.lat, c.lng]) <= 50
          );
          if (!exists) {
            technicalWarnings.push({
              lat: c.lat,
              lng: c.lng,
              mtbScale: c.mtbScale,
              name: c.name || 'Severe Technical Singletrack',
              description: `Singletrail Scale S${c.mtbScale}+ (extreme obstacles, large rock gardens, steep drop-offs >40% grade). Requires advanced bike handling skills.`,
            });
          }
        }
      }
    }
  }

  const gravelFallbackUsed =
    activity === 'mountain_bike' &&
    corridors.some((c) => c.type === 'gravel_path') &&
    !corridors.some((c) => c.type === 'mtb_trail');

  return {
    coordinates: finalCoords,
    safeCrossings: bestSafeCrossings,
    technicalWarnings: technicalWarnings.length > 0 ? technicalWarnings : undefined,
    gravelFallbackUsed: gravelFallbackUsed || undefined,
  };
}

/**
 * Apply PostGIS-style Privacy Masking (500m truncation or jitter)
 */
export function applyPrivacyMasking(
  coordinates: [number, number][],
  totalDistanceKm: number,
  enabled: boolean
): {
  maskedCoordinates: [number, number][];
  privacyInfo: PrivacyMaskInfo;
} {
  const originalStart: LatLng = { lat: coordinates[0][0], lng: coordinates[0][1] };
  const originalEnd: LatLng = {
    lat: coordinates[coordinates.length - 1][0],
    lng: coordinates[coordinates.length - 1][1],
  };

  if (!enabled || coordinates.length < 5) {
    return {
      maskedCoordinates: coordinates,
      privacyInfo: {
        applied: false,
        strategy: 'none',
        originalStart,
        maskedStart: originalStart,
        originalEnd,
        maskedEnd: originalEnd,
        bufferRadiusMeters: 0,
      },
    };
  }

  // Strategy A: Truncate 500m from start and end if route is > 5km
  if (totalDistanceKm > 5.0) {
    let startCutIndex = 0;
    let distFromStartM = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      distFromStartM += calculateDistanceMeters(coordinates[i], coordinates[i + 1]);
      if (distFromStartM >= 500) {
        startCutIndex = i + 1;
        break;
      }
    }

    let endCutIndex = coordinates.length - 1;
    let distFromEndM = 0;
    for (let i = coordinates.length - 1; i > 0; i--) {
      distFromEndM += calculateDistanceMeters(coordinates[i], coordinates[i - 1]);
      if (distFromEndM >= 500) {
        endCutIndex = i - 1;
        break;
      }
    }

    if (startCutIndex < endCutIndex && endCutIndex - startCutIndex > 2) {
      const truncated = coordinates.slice(startCutIndex, endCutIndex + 1);
      const maskedStart = { lat: truncated[0][0], lng: truncated[0][1] };
      const maskedEnd = {
        lat: truncated[truncated.length - 1][0],
        lng: truncated[truncated.length - 1][1],
      };

      return {
        maskedCoordinates: truncated,
        privacyInfo: {
          applied: true,
          strategy: 'truncate_500m',
          originalStart,
          maskedStart,
          originalEnd,
          maskedEnd,
          bufferRadiusMeters: 500,
        },
      };
    }
  }

  // Strategy B: For shorter routes (<= 5km), apply spatial jitter to protect doorstep PII
  const randomAngle = Math.random() * 2 * Math.PI;
  const jitterDistM = 250 + Math.random() * 150;
  const dLat = (jitterDistM * Math.cos(randomAngle)) / 111000;
  const dLng =
    (jitterDistM * Math.sin(randomAngle)) / (111000 * Math.cos((originalStart.lat * Math.PI) / 180));

  const jittered: [number, number][] = coordinates.map(([lat, lng], idx) => {
    const weight = 1.0 - idx / coordinates.length;
    return [lat + dLat * weight, lng + dLng * weight];
  });

  const maskedStart = { lat: jittered[0][0], lng: jittered[0][1] };
  const maskedEnd = {
    lat: jittered[jittered.length - 1][0],
    lng: jittered[jittered.length - 1][1],
  };

  return {
    maskedCoordinates: jittered,
    privacyInfo: {
      applied: true,
      strategy: 'jitter_500m',
      originalStart,
      maskedStart,
      originalEnd,
      maskedEnd,
      bufferRadiusMeters: 500,
    },
  };
}

/**
 * Generate synthetic topography and elevation points based on coordinate path
 */
export function generateElevationProfile(
  coordinates: [number, number][],
  elevationPreference: ElevationPreference = 'flat',
  unit: DistanceUnit = 'km'
): { profile: ElevationPoint[]; gainM: number; lossM: number; highestM: number; lowestM: number } {
  const profile: ElevationPoint[] = [];
  let currentDistM = 0;

  const baseElevation = 45 + Math.sin(coordinates[0][0] * 10) * 20;
  const scale = elevationPreference === 'flat' ? 4 : elevationPreference === 'moderate' ? 24 : 60;

  let prevEle = baseElevation;
  let gainM = 0;
  let lossM = 0;
  let highestM = baseElevation;
  let lowestM = baseElevation;

  profile.push({
    distance: 0,
    elevation: Math.round(baseElevation),
    grade: 0,
    lat: coordinates[0][0],
    lng: coordinates[0][1],
  });

  for (let i = 1; i < coordinates.length; i++) {
    const stepDistM = calculateDistanceMeters(coordinates[i - 1], coordinates[i]);
    currentDistM += stepDistM;

    const latFactor = Math.sin(coordinates[i][0] * 350);
    const lngFactor = Math.cos(coordinates[i][1] * 280);
    const microWave = Math.sin(i * 0.15) * 2;
    const currentElevation = Math.max(
      5,
      baseElevation + (latFactor + lngFactor) * (scale / 2) + microWave
    );

    const diff = currentElevation - prevEle;
    if (diff > 0) gainM += diff;
    else lossM += Math.abs(diff);

    highestM = Math.max(highestM, currentElevation);
    lowestM = Math.min(lowestM, currentElevation);

    const grade = stepDistM > 0 ? (diff / stepDistM) * 100 : 0;
    const distanceOutput = unit === 'km' ? currentDistM / 1000 : (currentDistM / 1000) * 0.621371;

    profile.push({
      distance: Number(distanceOutput.toFixed(2)),
      elevation: Math.round(currentElevation),
      grade: Number(grade.toFixed(1)),
      lat: coordinates[i][0],
      lng: coordinates[i][1],
    });

    prevEle = currentElevation;
  }

  return {
    profile,
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    highestM: Math.round(highestM),
    lowestM: Math.round(lowestM),
  };
}

/**
 * Calculate workout statistics based on activity and distance
 */
export function calculateWorkoutStats(
  distanceKm: number,
  elevationGainM: number,
  activity: ActivityType
): { durationMinutes: number; calories: number } {
  let speedKmh = 10;
  let met = 9.8;

  switch (activity) {
    case 'run':
      speedKmh = 10.2;
      met = 9.8;
      break;
    case 'road_bike':
      speedKmh = 23.5;
      met = 8.0;
      break;
    case 'mountain_bike':
      speedKmh = 14.5;
      met = 8.5;
      break;
    case 'bike':
      speedKmh = 21.5;
      met = 7.5;
      break;
    case 'hike':
      speedKmh = 4.2;
      met = 6.0;
      break;
  }

  const baseHours = distanceKm / speedKmh;
  const hillMinutes = elevationGainM / 15;
  const totalMinutes = Math.round(baseHours * 60 + hillMinutes);
  const calories = Math.round(met * 70 * (totalMinutes / 60));

  return {
    durationMinutes: Math.max(5, totalMinutes),
    calories,
  };
}

/**
 * Master Route Generator Function
 */
export async function generateFullRoute(params: {
  startLocation: LatLng;
  startingAddress: string;
  activity: ActivityType;
  routeType: RouteType;
  targetDistanceKm: number;
  gpsArtText?: string;
  routeName?: string;
  elevationPreference?: ElevationPreference;
  privacyMaskingEnabled?: boolean;
  unit?: DistanceUnit;
  apiConfig?: ApiConfiguration;
}): Promise<GeneratedRoute> {
  const {
    startLocation,
    startingAddress,
    activity,
    routeType,
    targetDistanceKm,
    gpsArtText,
    routeName,
    elevationPreference = 'moderate',
    privacyMaskingEnabled = false,
    unit = 'km',
    apiConfig,
  } = params;

  let rawCoordinates: [number, number][] = [];
  let confidenceScore: number | undefined = undefined;
  let safeCrossings: SafeCrossing[] = [];
  let technicalWarnings: TechnicalSegmentWarning[] | undefined = undefined;
  let gravelFallbackUsed: boolean | undefined = undefined;

  // 1. GPS Art Generation
  if (routeType === 'gps_art') {
    const artResult = await generateRoadGpsArtRoute(
      startLocation,
      gpsArtText || 'RUN',
      targetDistanceKm,
      activity,
      apiConfig
    );
    rawCoordinates = artResult.coordinates;
    confidenceScore = artResult.confidenceScore;
  } else if (routeType === 'loop') {
    // 2. Real Road Loop Route
    const loopResult = await generateRoadLoopRoute(
      startLocation,
      targetDistanceKm,
      activity,
      apiConfig
    );
    rawCoordinates = loopResult.coordinates;
    safeCrossings = loopResult.safeCrossings;
    technicalWarnings = loopResult.technicalWarnings;
    gravelFallbackUsed = loopResult.gravelFallbackUsed;
  } else {
    // 3. Real Road Out-and-Back Route
    const outBackResult = await generateRoadOutAndBackRoute(
      startLocation,
      targetDistanceKm,
      activity,
      apiConfig
    );
    rawCoordinates = outBackResult.coordinates;
    safeCrossings = outBackResult.safeCrossings;
    technicalWarnings = outBackResult.technicalWarnings;
    gravelFallbackUsed = outBackResult.gravelFallbackUsed;
  }

  // Smooth out micro-jags across all route modes so smartwatches don't fire unnecessary turn alerts
  const isClosed =
    rawCoordinates.length >= 2 &&
    calculateDistanceMeters(rawCoordinates[0], rawCoordinates[rawCoordinates.length - 1]) <= 60;
  rawCoordinates = minimizeMicroTurns(rawCoordinates, isClosed);

  const actualDistanceKm = calculateTotalDistanceKm(rawCoordinates);

  // Apply Privacy Masking
  const { maskedCoordinates, privacyInfo } = applyPrivacyMasking(
    rawCoordinates,
    actualDistanceKm,
    privacyMaskingEnabled
  );

  // Generate Elevation Profile
  const eleData = generateElevationProfile(maskedCoordinates, elevationPreference, unit);

  // Workout Stats
  const workoutStats = calculateWorkoutStats(actualDistanceKm, eleData.gainM, activity);

  const finalStats: RouteStats = {
    distanceKm: Number(actualDistanceKm.toFixed(2)),
    distanceMi: Number((actualDistanceKm * 0.621371).toFixed(2)),
    elevationGainM: eleData.gainM,
    elevationLossM: eleData.lossM,
    estimatedDurationMinutes: workoutStats.durationMinutes,
    estimatedCalories: workoutStats.calories,
    confidenceScore,
    turnCount: countSignificantTurns(maskedCoordinates),
    highestPointM: eleData.highestM,
    lowestPointM: eleData.lowestM,
    safeCrossingCount: safeCrossings.length,
  };

  const activityLabel =
    activity === 'road_bike'
      ? 'Road Bike'
      : activity === 'mountain_bike'
      ? 'Mountain Bike'
      : activity === 'run'
      ? 'Run'
      : activity === 'hike'
      ? 'Hike'
      : 'Bike';

  const defaultName =
    routeName?.trim() ||
    (routeType === 'gps_art'
      ? `GPS Art "${(gpsArtText || 'RUN').toUpperCase()}" (${finalStats.distanceKm} km)`
      : `${activityLabel} ${routeType === 'loop' ? 'Loop' : 'Out & Back'} (${finalStats.distanceKm} km)`);

  const terrainFocus =
    activity === 'run'
      ? '🌿 Greenbelts, Parks & Calm Road Layouts'
      : activity === 'road_bike' || activity === 'bike'
      ? '🚴 Designated Bike Lanes & Paved Greenways'
      : activity === 'mountain_bike'
      ? '🚵 Dirt Trails, Singletracks & Forest Paths via Road Connectors'
      : '🥾 Actual Nature Trails & Singletracks';

  const surfaceType =
    activity === 'run'
      ? 'Paved Greenways, Park Paths & Smooth Road Centerlines (Sidewalk-Free)'
      : activity === 'road_bike' || activity === 'bike'
      ? 'Smooth Paved Asphalt, Protected Cycle Tracks & Low-Stress Road Corridors'
      : activity === 'mountain_bike'
      ? 'Unpaved Singletracks, Natural Trails, Dirt Tracks & Connecting Roads'
      : 'Natural Dirt Trails, Forest Footpaths & Mountain Tracks';

  return {
    id: `route_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: defaultName,
    activity,
    routeType,
    gpsArtText: routeType === 'gps_art' ? gpsArtText : undefined,
    coordinates: maskedCoordinates,
    elevationProfile: eleData.profile,
    stats: finalStats,
    privacy: privacyInfo,
    safeCrossings,
    technicalWarnings,
    gravelFallbackUsed,
    terrainFocus,
    surfaceType,
    createdAt: new Date().toISOString(),
    startingAddress: startingAddress || `${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)}`,
  };
}
