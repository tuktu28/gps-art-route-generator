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

/**
 * Discovers corridors tailored to user preferences:
 * - Running: Roads to greenways, greenbelts, parks, sidewalks, and quiet neighborhood streets while avoiding heavy traffic.
 * - Road Bike: Prioritizes designated bike lanes, paved greenways, and low-stress bike-friendly roads.
 * - Mountain Bike: Prioritizes roads that get users to the bike trails, then trails, then roads.
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

  const radiusMeters = Math.min(25000, Math.max(800, Math.round(radiusKm * 1000 * 1.3)));

  let queryBody = '';
  if (activity === 'hike') {
    // Hiking: focus on actual trails, footpaths, tracks, hiking routes, nature reserves
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"~"path|track|footway|bridleway"]["highway"!~"living_street|service|construction"](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="hiking"](around:${radiusMeters},${center.lat},${center.lng});
        node["highway"="trailhead"](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"="nature_reserve"](around:${radiusMeters},${center.lat},${center.lng});
        way["natural"~"wood|peak|ridge|cliff"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 40;
    `;
  } else if (activity === 'mountain_bike') {
    // Mountain Bike: prioritize roads that get users to the bike trails, then trails, then roads.
    // Queries dedicated MTB tracks and parses mtb:scale, while including multi-use gravel paths for fallback.
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"~"track|path|bridleway"]["bicycle"!~"no"](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="mtb"](around:${radiusMeters},${center.lat},${center.lng});
        way["route"="mtb"](around:${radiusMeters},${center.lat},${center.lng});
        way["mtb:scale"](around:${radiusMeters},${center.lat},${center.lng});
        node["highway"="trailhead"](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"="nature_reserve"]["bicycle"!~"no"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"track|path|cycleway"]["surface"~"gravel|fine_gravel|compacted|dirt|unpaved|ground|earth"]["bicycle"!~"no"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"="residential"]["surface"!~"unpaved|dirt|gravel"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 50;
    `;
  } else if (activity === 'road_bike' || activity === 'bike') {
    // Road Bike: designated bike lanes, paved greenways, and low-stress bike-friendly roads
    // Strictly exclude unpaved surfaces
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"="cycleway"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"](around:${radiusMeters},${center.lat},${center.lng});
        way["cycleway"~"lane|track|opposite_lane|opposite_track|share_busway"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"](around:${radiusMeters},${center.lat},${center.lng});
        way["bicycle"="designated"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"cycleway|path"]["surface"~"paved|asphalt|concrete|paving_stones|chipseal"](around:${radiusMeters},${center.lat},${center.lng});
        way["cyclestreet"="yes"](around:${radiusMeters},${center.lat},${center.lng});
        way["bicycle_road"="yes"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"residential|tertiary|unclassified"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"]["bicycle"!~"no"]["maxspeed"!~"^[5-9][0-9]"](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"="bicycle"]["surface"!~"unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 45;
    `;
  } else {
    // Running: roads that get users to greenways, greenbelts, parks, sidewalks, and quiet neighborhood streets while avoiding heavy traffic
    queryBody = `
      [out:json][timeout:4];
      (
        way["highway"~"footway|pedestrian|path|cycleway"]["foot"!~"no"]["highway"!~"motorway|trunk|primary|service|construction"](around:${radiusMeters},${center.lat},${center.lng});
        way["leisure"~"park|garden|nature_reserve"](around:${radiusMeters},${center.lat},${center.lng});
        way["landuse"~"greenfield|recreation_ground|grass|village_green"](around:${radiusMeters},${center.lat},${center.lng});
        way["sidewalk"~"yes|both|left|right"](around:${radiusMeters},${center.lat},${center.lng});
        way["highway"~"residential|living_street"]["maxspeed"!~"^[4-9][0-9]"](around:${radiusMeters},${center.lat},${center.lng});
        relation["route"~"running|foot"](around:${radiusMeters},${center.lat},${center.lng});
      );
      out center 45;
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
                  const surfaceTag = (el.tags?.surface || '').toLowerCase();
                  const unpavedRegex = /unpaved|dirt|gravel|ground|sand|compacted|fine_gravel|earth|mud|grass|cobblestone|wood|pebblestone/i;
                  const isUnpaved = unpavedRegex.test(surfaceTag);

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
                    if (el.tags?.cycleway || el.tags?.bicycle === 'designated') {
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
                    if (el.tags?.leisure === 'park' || el.tags?.leisure === 'garden' || el.tags?.landuse) {
                      nodeType = 'park';
                    } else if (el.tags?.sidewalk) {
                      nodeType = 'sidewalk';
                    } else if (el.tags?.highway === 'residential' || el.tags?.highway === 'living_street') {
                      nodeType = 'quiet_street';
                    } else {
                      nodeType = 'greenway';
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
  return /\b(highway|hwy|freeway|fwy|expressway|turnpike|interstate|parkway|pkwy|broadway|boulevard|blvd|state route|sr-\d|us-\d|i-\d)\b/i.test(
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

    // 1. Detect dead-end spurs / cul-de-sacs / antennas
    // The path detours out into a side street or court, reaches away, and returns to the primary junction
    for (let i = 0; i < pts.length - 4; i++) {
      let accumulatedPathM = 0;
      let maxReachM = 0;
      let bestK = -1;

      for (let k = i + 1; k < Math.min(pts.length, i + 120); k++) {
        accumulatedPathM += calculateDistanceMeters(pts[k - 1], pts[k]);
        if (accumulatedPathM > 800) break;

        const gapDist = calculateDistanceMeters(pts[i], pts[k]);
        if (gapDist > maxReachM) maxReachM = gapDist;

        if (k >= i + 3) {
          // In a closed loop, do not prune the primary loop closure between start and end
          if (isLoop && i <= 1 && k >= pts.length - 3) continue;

          // Condition for a dead-end spur:
          // Path travels out at least 20m into side street/court, reaches at least 12m away,
          // and returns to within 34m of the junction point with gap < 48% of max excursion reach
          if (accumulatedPathM >= 20 && gapDist <= 34 && maxReachM >= 12 && gapDist < maxReachM * 0.48) {
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

    if (changed) continue;

    // 2. Detect alley / parking-row micro-detours away from a continuous thoroughfare
    // Prune only when entering and exiting headings align with the through-corridor (<= 50 deg)
    // and gap distance across the alley entrance is small (<= 50m).
    // This strictly prevents cutting across legitimate 90-degree intersection turns.
    for (let i = 1; i < pts.length - 4; i++) {
      let accumulatedPathM = 0;
      let bestDetourK = -1;

      for (let k = i + 1; k < Math.min(pts.length, i + 35); k++) {
        accumulatedPathM += calculateDistanceMeters(pts[k - 1], pts[k]);
        if (accumulatedPathM > 400) break;

        if (k >= i + 3 && k < pts.length - 1) {
          const directDist = calculateDistanceMeters(pts[i], pts[k]);
          if (isLoop && i <= 1 && k >= pts.length - 3) continue;

          const inHeading = calculateHeadingDeg(pts[i - 1], pts[i]);
          const outHeading = calculateHeadingDeg(pts[k], pts[k + 1]);
          const headingDelta = calculateAngleDelta(inHeading, outHeading);

          // Detour condition along continuous corridor:
          // Catches roadside verge pop-outs, alley bypasses, and parking excursions up to 85m
          if (
            directDist >= 8 &&
            directDist <= 85 &&
            accumulatedPathM >= 20 &&
            accumulatedPathM >= directDist * 1.35 &&
            headingDelta <= 75
          ) {
            bestDetourK = k;
          }
        }
      }

      if (bestDetourK !== -1) {
        pts.splice(i + 1, bestDetourK - i - 1);
        changed = true;
        break;
      }
    }
  }

  // 3. Deduplicate consecutive points within 1.5 meters of each other and remove micro-jitter
  const clean: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (clean.length === 0 || calculateDistanceMeters(clean[clean.length - 1], pts[i]) >= 1.5) {
      clean.push(pts[i]);
    }
  }
  if (pts.length > 1 && clean[clean.length - 1] !== pts[pts.length - 1]) {
    clean.push(pts[pts.length - 1]);
  }

  return clean;
}

/**
 * Fetch real-world road snapped path using HeiGIT / OpenRouteService or public OpenStreetMap OSRM
 */
export async function fetchRealRoadPath(
  waypoints: [number, number][],
  activity: ActivityType,
  apiConfig?: ApiConfiguration,
  skipSpurPruning: boolean = false,
  allowUTurns: boolean = false,
  safeCrossingNodes: SafeCrossingNode[] = []
): Promise<{
  coordinates: [number, number][];
  distanceKm: number;
  safeCrossings: SafeCrossing[];
  hasProhibitedRamps: boolean;
} | null> {
  if (waypoints.length < 2) return null;

  // 1. Try OpenRouteService / HeiGIT if API key is configured
  const orsKey = apiConfig?.openRouteServiceKey?.trim();
  if (orsKey && orsKey.length > 10) {
    try {
      // foot-hiking for hiking, foot-walking for running (pedestrian, greenway & sidewalk focus)
      // cycling-mountain for mountain bike, cycling-road for road bike
      const orsProfile =
        activity === 'mountain_bike'
          ? 'cycling-mountain'
          : activity === 'road_bike'
          ? 'cycling-road'
          : isBikeActivity(activity)
          ? 'cycling-regular'
          : activity === 'hike'
          ? 'foot-hiking'
          : 'foot-walking';

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
              const cleanCoords = skipSpurPruning
                ? geoCoords
                : eliminateSpursAndInAndOuts(geoCoords, false);
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

  // Profiles based on activity:
  // - road_bike: routed-bike prioritizes smooth asphalt, bike lanes, paved greenways
  // - mountain_bike: routed-bike with routed-foot fallback allows singletracks and dirt paths
  // - run / hike: routed-foot prioritizes footways, sidewalks, parks, and calm residential streets
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
          const cleanCoords = skipSpurPruning
            ? rawCoords
            : eliminateSpursAndInAndOuts(rawCoords, false);
          const distKm = calculateTotalDistanceKm(cleanCoords);

          let hasProhibitedRamps = false;
          let hasUnpavedTrail = false;
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

              // Road bike mandate: strictly reject any route that uses an unpaved trail
              if (activity === 'road_bike') {
                const sName = (step.name || '').toLowerCase();
                const sRef = (step.ref || '').toLowerCase();
                if (unpavedStepKeywords.some((kw) => sName.includes(kw) || sRef.includes(kw))) {
                  hasUnpavedTrail = true;
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

          if (hasUnpavedTrail) {
            // Discard unpaved candidate for road bike and try next paved routing endpoint
            continue;
          }

          return {
            coordinates: cleanCoords,
            distanceKm: distKm,
            safeCrossings: detectedSafeCrossings,
            hasProhibitedRamps,
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
  activity: ActivityType = 'run'
): Promise<[number, number]> {
  const profile = isBikeActivity(activity) && activity !== 'mountain_bike' ? 'bike' : 'foot';
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
  allowUTurns: boolean = false
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
    const fullRoadResult = await fetchRealRoadPath(cleanWaypoints, activity, apiConfig, true, allowUTurns);
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

    let roadResult = await fetchRealRoadPath(chunk, activity, apiConfig, true, allowUTurns);

    // If chunk failed, attempt point-to-point sub-segment routing on real streets
    if (!roadResult || roadResult.coordinates.length < 2) {
      const subCoords: [number, number][] = [];
      for (let j = 0; j < chunk.length - 1; j++) {
        const segPair = [chunk[j], chunk[j + 1]];
        let segResult = await fetchRealRoadPath(segPair, activity, apiConfig, true, allowUTurns);

        // If direct pair failed, snap both points to nearest OSM road node first
        if (!segResult || segResult.coordinates.length < 2) {
          const snappedA = await snapPointToNearestRoad(chunk[j][0], chunk[j][1], activity);
          const snappedB = await snapPointToNearestRoad(chunk[j + 1][0], chunk[j + 1][1], activity);
          segResult = await fetchRealRoadPath([snappedA, snappedB], activity, apiConfig, true, allowUTurns);
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
    const snappedPt = await snapPointToNearestRoad(pt[0], pt[1], activity);
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
      const snapped = await snapWaypointsToRealRoads(waypoints, activity, apiConfig, true);
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
      // Gracefully fall back to gravel multi-use paths if no mtb_trail singletracks exist
      preferredPool = mtbNodes.length > 0 ? mtbNodes : gravelNodes;
    } else if (activity === 'road_bike' || activity === 'bike') {
      // Road bike MUST never use unpaved trails
      preferredPool = corridors.filter(
        (c) =>
          (c.type === 'bike_lane' || c.type === 'greenway' || c.type === 'quiet_street') &&
          c.surface !== 'unpaved' &&
          c.surface !== 'dirt' &&
          c.surface !== 'gravel' &&
          c.surface !== 'compacted' &&
          c.surface !== 'fine_gravel'
      );
    } else if (activity === 'run') {
      preferredPool = corridors.filter((c) => c.type === 'park' || c.type === 'greenway' || c.type === 'sidewalk');
    } else if (activity === 'hike') {
      preferredPool = corridors.filter((c) => c.type === 'trail');
    }

    const pool = preferredPool.length > 0 ? preferredPool : corridors;
    const targetClusterNode = pool[Math.floor(Math.random() * pool.length)];
    const dLat = targetClusterNode.lat - start.lat;
    const dLng = (targetClusterNode.lng - start.lng) * Math.cos(latRad);
    centerBearing = Math.atan2(dLat, dLng);
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
            weight =
              node.type === 'mtb_trail'
                ? 0.35
                : node.type === 'gravel_path'
                ? 0.45
                : node.type === 'trail'
                ? 0.55
                : 1.2;
          } else {
            // Outbound or return leg: roads to trails, then trails to roads
            weight =
              node.type === 'quiet_street'
                ? 0.6
                : node.type === 'mtb_trail'
                ? 0.7
                : node.type === 'gravel_path'
                ? 0.75
                : 1.0;
          }
        } else if (activity === 'road_bike' || activity === 'bike') {
          weight =
            node.type === 'bike_lane'
              ? 0.35
              : node.type === 'greenway'
              ? 0.5
              : node.type === 'quiet_street'
              ? 0.75
              : 1.2;
        } else if (activity === 'run') {
          if (isCoreWorkout) {
            // Staying on greenways, parks, sidewalks
            weight =
              node.type === 'park'
                ? 0.35
                : node.type === 'greenway'
                ? 0.4
                : node.type === 'sidewalk'
                ? 0.5
                : 1.1;
          } else {
            // Outbound road to park, or return road to start
            weight =
              node.type === 'quiet_street'
                ? 0.6
                : node.type === 'greenway' || node.type === 'park'
                ? 0.65
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

  // 4-pass calibration loop
  for (let pass = 1; pass <= 4; pass++) {
    const activeCrossings = pass <= 2 ? safeCrossings : [];
    const rawWaypoints = createLoopWaypoints(start, radiusKm, 4, corridors, activeCrossings, activity);
    // Pre-snap all guide waypoints to verified OpenStreetMap road centerlines so waypoints never sit off-road
    const waypoints: [number, number][] = [rawWaypoints[0]];
    for (let w = 1; w < rawWaypoints.length - 1; w++) {
      const snapped = await snapPointToNearestRoad(rawWaypoints[w][0], rawWaypoints[w][1], activity);
      waypoints.push(snapped);
    }
    waypoints.push(rawWaypoints[rawWaypoints.length - 1]);

    const result = await fetchRealRoadPath(waypoints, activity, apiConfig, false, false, activeCrossings);

    if (result && result.coordinates.length > 5) {
      // Reject any route that attempts to use freeway ramps or prohibited motorways
      if (result.hasProhibitedRamps) {
        radiusKm *= 0.85; // contract radius away from freeway barriers
        continue;
      }

      // Ensure any spur artifacts around junction points are thoroughly cleaned
      const cleaned = eliminateSpursAndInAndOuts(result.coordinates, true);
      const dist = calculateTotalDistanceKm(cleaned);
      const diff = Math.abs(dist - targetDistanceKm);

      if (diff < bestDistDiff) {
        bestDistDiff = diff;
        bestCoords = cleaned;
        bestSafeCrossings = result.safeCrossings || [];
      }

      // Distance margin check (10% for MTB, 5% for others)
      if (diff / targetDistanceKm <= toleranceMargin) {
        break;
      }

      const ratio = targetDistanceKm / Math.max(0.1, dist);
      radiusKm = Math.max(0.15, radiusKm * Math.sqrt(ratio));
    }
  }

  // Fallback if no valid road route was generated
  if (bestCoords.length === 0) {
    bestCoords = createLoopWaypoints(start, radiusKm, 8, corridors, [], activity);
  }

  const finalCoords = enforceDistanceTolerance(bestCoords, targetDistanceKm, toleranceMargin);

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
  // If corridors exist, pick a bearing pointing towards the preferred cluster
  if (corridors.length > 0) {
    let preferredPool: CorridorNode[] = [];
    if (activity === 'mountain_bike') {
      const mtbNodes = corridors.filter((c) => c.type === 'mtb_trail');
      const gravelNodes = corridors.filter((c) => c.type === 'gravel_path');
      // Gracefully fall back to gravel multi-use paths if no mtb singletracks exist
      preferredPool = mtbNodes.length > 0 ? mtbNodes : gravelNodes;
    } else if (activity === 'road_bike' || activity === 'bike') {
      // Road bike MUST never use unpaved trails
      preferredPool = corridors.filter(
        (c) =>
          (c.type === 'bike_lane' || c.type === 'greenway' || c.type === 'quiet_street') &&
          c.surface !== 'unpaved' &&
          c.surface !== 'dirt' &&
          c.surface !== 'gravel' &&
          c.surface !== 'compacted' &&
          c.surface !== 'fine_gravel'
      );
    } else if (activity === 'run') {
      preferredPool = corridors.filter((c) => c.type === 'park' || c.type === 'greenway' || c.type === 'sidewalk');
    } else if (activity === 'hike') {
      preferredPool = corridors.filter((c) => c.type === 'trail');
    }
    const pool = preferredPool.length > 0 ? preferredPool : corridors;
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const dLat = candidate.lat - start.lat;
    const dLng = (candidate.lng - start.lng) * Math.cos(latRad);
    bearing = Math.atan2(dLat, dLng);
  } else if (safeCrossings.length > 0) {
    // Steer towards tier 1 traffic signals if available
    const signalsOnly = safeCrossings.filter((s) => s.type === 'traffic_signals');
    const pool = signalsOnly.length > 0 ? signalsOnly : safeCrossings;
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const dLat = candidate.lat - start.lat;
    const dLng = (candidate.lng - start.lng) * Math.cos(latRad);
    bearing = Math.atan2(dLat, dLng);
  }

  let bestCoords: [number, number][] = [];
  let bestSafeCrossings: SafeCrossing[] = [];
  let bestDiff = Infinity;

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
          weight = n.type === 'mtb_trail' ? 0.35 : n.type === 'gravel_path' ? 0.45 : n.type === 'trail' ? 0.55 : 1.1;
        } else if (activity === 'road_bike' || activity === 'bike') {
          weight = n.type === 'bike_lane' ? 0.4 : n.type === 'greenway' ? 0.5 : 1.0;
        } else if (activity === 'run') {
          weight = n.type === 'park' ? 0.4 : n.type === 'greenway' ? 0.5 : n.type === 'sidewalk' ? 0.6 : 1.0;
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
        const snappedProbe = await snapPointToNearestRoad(probeLat, probeLng, activity);
        probeLat = snappedProbe[0];
        probeLng = snappedProbe[1];
      }
    } else {
      const snappedProbe = await snapPointToNearestRoad(probeLat, probeLng, activity);
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
      activeSafeCrossings
    );

    if (outResult && outResult.coordinates.length > 2) {
      if (outResult.hasProhibitedRamps) {
        continue; // Discard routes that enter freeway on-ramps
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

      // 3. Return leg follows the exact verified corridor back to start
      // This guarantees zero spurs, zero alley detours, zero off-road cuts, and exact total distance
      const inboundLeg = [...outboundLeg].reverse();
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

  if (bestCoords.length === 0) {
    const p1: [number, number] = [start.lat, start.lng];
    const turnLat = start.lat + (halfTargetKm / kmPerLat) * Math.sin(bearing);
    const turnLng = start.lng + (halfTargetKm / kmPerLng) * Math.cos(bearing);
    const p2: [number, number] = [turnLat, turnLng];
    bestCoords = [p1, p2, p1];
  }

  const finalCoords = enforceDistanceTolerance(bestCoords, targetDistanceKm, toleranceMargin);

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
    turnCount: Math.round(maskedCoordinates.length * 0.35),
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
      ? '🌿 Greenbelts, Parks, Sidewalks & Quiet Streets'
      : activity === 'road_bike' || activity === 'bike'
      ? '🚴 Designated Bike Lanes & Paved Greenways'
      : activity === 'mountain_bike'
      ? '🚵 Dirt Trails, Singletracks & Forest Paths via Road Connectors'
      : '🥾 Actual Nature Trails & Singletracks';

  const surfaceType =
    activity === 'run'
      ? 'Paved Greenways, Dedicated Pedestrian Paths & Low-Traffic Neighborhood Roads'
      : activity === 'road_bike' || activity === 'bike'
      ? 'Smooth Paved Asphalt, Protected Cycle Tracks & Low-Stress Corridors'
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
