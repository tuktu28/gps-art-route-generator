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
} from '../types/route';
import { generateGlyphPolyline } from './glyphEngine';

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
 * Fetch real-world road snapped path using HeiGIT / OpenRouteService or public OpenStreetMap OSRM
 */
export async function fetchRealRoadPath(
  waypoints: [number, number][],
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<{ coordinates: [number, number][]; distanceKm: number } | null> {
  if (waypoints.length < 2) return null;

  // 1. Try OpenRouteService / HeiGIT if API key is configured
  const orsKey = apiConfig?.openRouteServiceKey?.trim();
  if (orsKey && orsKey.length > 10) {
    try {
      const orsProfile =
        activity === 'bike' ? 'cycling-regular' : activity === 'hike' ? 'foot-hiking' : 'foot-walking';

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
              const distKm =
                data.features[0].properties?.summary?.distance !== undefined
                  ? data.features[0].properties.summary.distance / 1000
                  : calculateTotalDistanceKm(geoCoords);

              return { coordinates: geoCoords, distanceKm: distKm };
            }
          }
        } catch (innerErr) {
          // try next endpoint or fallback
        }
      }
    } catch (orsErr) {
      console.warn('OpenRouteService request error, falling back to OSRM:', orsErr);
    }
  }

  // 2. Query Public OpenStreetMap OSRM Routing Engines (Free, accurate real-road routing)
  const coordString = waypoints.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');

  // Profiles based on activity
  const osrmEndpoints =
    activity === 'bike'
      ? [
          `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordString}?overview=full&geometries=geojson`,
          `https://router.project-osrm.org/route/v1/bike/${coordString}?overview=full&geometries=geojson`,
          `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`,
        ]
      : [
          `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordString}?overview=full&geometries=geojson`,
          `https://router.project-osrm.org/route/v1/foot/${coordString}?overview=full&geometries=geojson`,
          `https://router.project-osrm.org/route/v1/walking/${coordString}?overview=full&geometries=geojson`,
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
          const distKm = route.distance / 1000;
          return { coordinates: rawCoords, distanceKm: distKm };
        }
      }
    } catch (e) {
      // try next mirror
    }
  }

  return null;
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
  const dLng = (jitterDistM * Math.sin(randomAngle)) / (111000 * Math.cos((originalStart.lat * Math.PI) / 180));

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
  elevationPreference: ElevationPreference = 'moderate',
  unit: DistanceUnit = 'km'
): { profile: ElevationPoint[]; gainM: number; lossM: number; highestM: number; lowestM: number } {
  const profile: ElevationPoint[] = [];
  let currentDistM = 0;

  const baseElevation = 45 + Math.sin(coordinates[0][0] * 10) * 20;
  const scale = elevationPreference === 'flat' ? 8 : elevationPreference === 'moderate' ? 28 : 65;

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
 * Generate radial guide waypoints for a loop
 */
function createLoopWaypoints(
  start: LatLng,
  radiusKm: number,
  numPoints: number = 4
): [number, number][] {
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Direction angle from start to loop center
  const centerBearing = Math.random() * 2 * Math.PI;
  const centerLat = start.lat + (radiusKm / kmPerLat) * Math.sin(centerBearing);
  const centerLng = start.lng + (radiusKm / kmPerLng) * Math.cos(centerBearing);

  const startAngle = Math.atan2(start.lat - centerLat, (start.lng - centerLng) * Math.cos(latRad));
  const waypoints: [number, number][] = [[start.lat, start.lng]];

  // Direction (clockwise or counter-clockwise)
  const dir = Math.random() > 0.5 ? 1 : -1;

  for (let i = 1; i < numPoints; i++) {
    const fraction = i / numPoints;
    const angle = startAngle + dir * fraction * 2 * Math.PI;
    const r = radiusKm * (0.85 + Math.random() * 0.3); // slight organic asymmetry

    const wLat = centerLat + (r / kmPerLat) * Math.sin(angle);
    const wLng = centerLng + (r / kmPerLng) * Math.cos(angle);
    waypoints.push([wLat, wLng]);
  }

  // Close back to start
  waypoints.push([start.lat, start.lng]);
  return waypoints;
}

/**
 * Generate accurate real-road Loop Route with calibrated distance matching
 */
export async function generateRoadLoopRoute(
  start: LatLng,
  targetDistanceKm: number,
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<[number, number][]> {
  // Road networks typically have a circuity (winding factor) of ~1.30 to 1.42
  // Perimeter P = 2 * PI * R * CircuityFactor => R = Target / (2 * PI * 1.35)
  let radiusKm = targetDistanceKm / (2 * Math.PI * 1.35);

  // 1. Initial attempt with estimated radius
  const waypoints1 = createLoopWaypoints(start, radiusKm, 4);
  const result1 = await fetchRealRoadPath(waypoints1, activity, apiConfig);

  if (result1 && result1.coordinates.length > 5) {
    const d1 = result1.distanceKm;
    const errorRatio = targetDistanceKm / Math.max(0.1, d1);

    // If within 5% of target, return immediately
    if (Math.abs(d1 - targetDistanceKm) / targetDistanceKm <= 0.05) {
      return result1.coordinates;
    }

    // 2. Calibrated 2nd attempt scaling radius proportionally
    const adjustedRadius = Math.max(0.2, radiusKm * Math.sqrt(errorRatio));
    const waypoints2 = createLoopWaypoints(start, adjustedRadius, 4);
    const result2 = await fetchRealRoadPath(waypoints2, activity, apiConfig);

    if (result2 && result2.coordinates.length > 5) {
      const d2 = result2.distanceKm;
      // Pick whichever result is closer to requested distance
      if (Math.abs(d2 - targetDistanceKm) < Math.abs(d1 - targetDistanceKm)) {
        return result2.coordinates;
      }
      return result1.coordinates;
    }

    return result1.coordinates;
  }

  // Fallback if no internet or routing API failed: geometric loop
  return generateGeometricLoop(start, targetDistanceKm);
}

/**
 * Generate accurate real-road Out-and-Back Route
 */
export async function generateRoadOutAndBackRoute(
  start: LatLng,
  targetDistanceKm: number,
  activity: ActivityType,
  apiConfig?: ApiConfiguration
): Promise<[number, number][]> {
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Turnaround point at approximately targetDistance / 2.3 (accounting for road winding)
  const oneWayStraightKm = (targetDistanceKm / 2) / 1.25;
  const bearing = Math.random() * 2 * Math.PI;

  const turnLat = start.lat + (oneWayStraightKm / kmPerLat) * Math.sin(bearing);
  const turnLng = start.lng + (oneWayStraightKm / kmPerLng) * Math.cos(bearing);

  // Route Outward
  const outResult = await fetchRealRoadPath(
    [[start.lat, start.lng], [turnLat, turnLng]],
    activity,
    apiConfig
  );

  // Route Inward (slight waypoint offset for return loop variety)
  const midLat = (start.lat + turnLat) / 2 + (0.002 * Math.cos(bearing + Math.PI / 2));
  const midLng = (start.lng + turnLng) / 2 + (0.002 * Math.sin(bearing + Math.PI / 2));

  const returnResult = await fetchRealRoadPath(
    [[turnLat, turnLng], [midLat, midLng], [start.lat, start.lng]],
    activity,
    apiConfig
  );

  if (outResult && returnResult) {
    const combined = [...outResult.coordinates, ...returnResult.coordinates.slice(1)];
    return combined;
  } else if (outResult) {
    const reversed = [...outResult.coordinates].reverse();
    return [...outResult.coordinates, ...reversed.slice(1)];
  }

  return generateGeometricOutAndBack(start, targetDistanceKm);
}

/**
 * Geometric Fallbacks (Only used when completely offline / no routing response)
 */
function generateGeometricLoop(start: LatLng, targetDistanceKm: number): [number, number][] {
  const radiusKm = targetDistanceKm / (2 * Math.PI);
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  const headingAngle = Math.random() * 2 * Math.PI;
  const centerLat = start.lat + (radiusKm / kmPerLat) * Math.sin(headingAngle);
  const centerLng = start.lng + (radiusKm / kmPerLng) * Math.cos(headingAngle);

  const numWaypoints = Math.max(16, Math.min(64, Math.round(targetDistanceKm * 4)));
  const points: [number, number][] = [];
  const startAngle = Math.atan2(start.lat - centerLat, (start.lng - centerLng) * Math.cos(latRad));

  for (let i = 0; i <= numWaypoints; i++) {
    const fraction = i / numWaypoints;
    const angle = startAngle + fraction * 2 * Math.PI;
    const lat = centerLat + (radiusKm / kmPerLat) * Math.sin(angle);
    const lng = centerLng + (radiusKm / kmPerLng) * Math.cos(angle);
    points.push([lat, lng]);
  }
  points[points.length - 1] = [start.lat, start.lng];
  return points;
}

function generateGeometricOutAndBack(start: LatLng, targetDistanceKm: number): [number, number][] {
  const oneWayDistanceKm = targetDistanceKm / 2;
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  const bearing = Math.random() * 2 * Math.PI;
  const numSteps = Math.max(12, Math.round(oneWayDistanceKm * 3));
  const outbound: [number, number][] = [];

  for (let i = 0; i <= numSteps; i++) {
    const progress = i / numSteps;
    const currentDist = progress * oneWayDistanceKm;
    const lat = start.lat + (currentDist * Math.cos(bearing)) / kmPerLat;
    const lng = start.lng + (currentDist * Math.sin(bearing)) / kmPerLng;
    outbound.push([lat, lng]);
  }

  const inbound = [...outbound].reverse();
  return [...outbound, ...inbound.slice(1)];
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
    privacyMaskingEnabled = true,
    unit = 'km',
    apiConfig,
  } = params;

  let rawCoordinates: [number, number][] = [];
  let confidenceScore: number | undefined = undefined;

  // 1. GPS Art Generation
  if (routeType === 'gps_art') {
    // Check if Render FastAPI Microservice is available
    const fastApiUrl = apiConfig?.fastApiEndpointUrl?.trim();
    if (fastApiUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${fastApiUrl}/api/v1/generate-art`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: gpsArtText || 'RUN',
            start_lat: startLocation.lat,
            start_lng: startLocation.lng,
            target_distance_km: targetDistanceKm,
            network_type: activity === 'bike' ? 'bike' : 'walk',
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const artData = await response.json();
          if (artData.coordinates && artData.coordinates.length > 5) {
            rawCoordinates = artData.coordinates;
            confidenceScore = artData.confidence_score;
          }
        }
      } catch (err) {
        console.warn('FastAPI microservice call failed, falling back to local glyph engine:', err);
      }
    }

    // Client-side glyph generator if microservice didn't respond
    if (rawCoordinates.length === 0) {
      const glyphResult = generateGlyphPolyline(
        gpsArtText || 'RUN',
        startLocation,
        targetDistanceKm
      );

      // Snap glyph corner waypoints to real streets using OSRM / ORS
      const keyWaypoints = glyphResult.coordinates.filter((_, idx) => idx % 3 === 0);
      if (keyWaypoints.length >= 2 && keyWaypoints.length <= 25) {
        const roadSnapped = await fetchRealRoadPath(keyWaypoints, activity, apiConfig);
        if (roadSnapped && roadSnapped.coordinates.length > 5) {
          rawCoordinates = roadSnapped.coordinates;
          confidenceScore = Math.max(70, glyphResult.confidenceScore);
        } else {
          rawCoordinates = glyphResult.coordinates;
          confidenceScore = glyphResult.confidenceScore;
        }
      } else {
        rawCoordinates = glyphResult.coordinates;
        confidenceScore = glyphResult.confidenceScore;
      }
    }
  } else if (routeType === 'loop') {
    // 2. Real Road Loop Route
    rawCoordinates = await generateRoadLoopRoute(
      startLocation,
      targetDistanceKm,
      activity,
      apiConfig
    );
  } else {
    // 3. Real Road Out-and-Back Route
    rawCoordinates = await generateRoadOutAndBackRoute(
      startLocation,
      targetDistanceKm,
      activity,
      apiConfig
    );
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
  };

  const defaultName =
    routeName?.trim() ||
    (routeType === 'gps_art'
      ? `GPS Art "${(gpsArtText || 'RUN').toUpperCase()}" (${finalStats.distanceKm} km)`
      : `${activity.toUpperCase()} ${routeType === 'loop' ? 'Loop' : 'Out & Back'} (${finalStats.distanceKm} km)`);

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
    createdAt: new Date().toISOString(),
    startingAddress: startingAddress || `${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)}`,
  };
}
