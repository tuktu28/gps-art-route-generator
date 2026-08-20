import {
  ActivityType,
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
 * Calculate total distance along a polyline
 */
export function calculateTotalDistanceKm(points: [number, number][]): number {
  let totalM = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalM += calculateDistanceMeters(points[i], points[i + 1]);
  }
  return totalM / 1000;
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

  // Strategy B: For shorter routes (<= 5km), apply 500m random spatial jitter/offset
  // to avoid exposing private residence coordinates while preserving route length
  const randomAngle = Math.random() * 2 * Math.PI;
  const jitterDistM = 350 + Math.random() * 150; // 350-500m jitter
  const dLat = (jitterDistM * Math.cos(randomAngle)) / 111000;
  const dLng = (jitterDistM * Math.sin(randomAngle)) / (111000 * Math.cos((originalStart.lat * Math.PI) / 180));

  const jittered: [number, number][] = coordinates.map(([lat, lng], idx) => {
    // Fade the jitter so overall geometry remains cohesive
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
  
  // Base elevation baseline for realism (e.g., 40m - 120m ASL)
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

    // Organic synthetic elevation waveform (perlin-like spatial frequency)
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

    const grade = stepDistM > 0 ? ((diff / stepDistM) * 100) : 0;
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
  // Speed in km/h: Run ~ 10 km/h (6:00/km), Bike ~ 22 km/h, Hike ~ 4.2 km/h
  let speedKmh = 10;
  let met = 9.8; // Metabolic Equivalent of Task

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

  // Hill penalty: +1 min per 15m elevation gain
  const baseHours = distanceKm / speedKmh;
  const hillMinutes = (elevationGainM / 15);
  const totalMinutes = Math.round(baseHours * 60 + hillMinutes);

  // Calories = MET * Weight(70kg) * Hours
  const calories = Math.round(met * 70 * (totalMinutes / 60));

  return {
    durationMinutes: Math.max(5, totalMinutes),
    calories,
  };
}

/**
 * Generate standard Loop Route around a central starting coordinate
 */
export function generateLoopRoute(
  start: LatLng,
  targetDistanceKm: number
): [number, number][] {
  // A circular / polygonal loop of radius R has perimeter 2 * PI * R
  // Hence R = targetDistanceKm / (2 * PI)
  const radiusKm = targetDistanceKm / (2 * Math.PI);
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Center offset so start point is on the loop perimeter
  const headingAngle = Math.random() * 2 * Math.PI;
  const centerLat = start.lat + (radiusKm / kmPerLat) * Math.sin(headingAngle);
  const centerLng = start.lng + (radiusKm / kmPerLng) * Math.cos(headingAngle);

  const numWaypoints = Math.max(16, Math.min(64, Math.round(targetDistanceKm * 4)));
  const points: [number, number][] = [];

  // Starting angle relative to center
  const startAngle = Math.atan2(start.lat - centerLat, (start.lng - centerLng) * Math.cos(latRad));

  for (let i = 0; i <= numWaypoints; i++) {
    const fraction = i / numWaypoints;
    const angle = startAngle + fraction * 2 * Math.PI;

    // Add organic wiggles to simulate turning street grid patterns
    const wiggleRadius = radiusKm * (1.0 + Math.sin(i * 1.8) * 0.12);

    const lat = centerLat + (wiggleRadius / kmPerLat) * Math.sin(angle);
    const lng = centerLng + (wiggleRadius / kmPerLng) * Math.cos(angle);

    points.push([lat, lng]);
  }

  // Ensure exact closure at start point
  points[points.length - 1] = [start.lat, start.lng];
  return points;
}

/**
 * Generate standard Out-and-Back Route
 */
export function generateOutAndBackRoute(
  start: LatLng,
  targetDistanceKm: number
): [number, number][] {
  const oneWayDistanceKm = targetDistanceKm / 2;
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Random outbound bearing (compass direction)
  const bearing = Math.random() * 2 * Math.PI;
  const numSteps = Math.max(12, Math.round(oneWayDistanceKm * 3));
  const outbound: [number, number][] = [];

  for (let i = 0; i <= numSteps; i++) {
    const progress = i / numSteps;
    const currentDist = progress * oneWayDistanceKm;

    // Minor road winding
    const lateralWiggle = Math.sin(progress * Math.PI * 3) * (oneWayDistanceKm * 0.08);

    const lat = start.lat +
      ((currentDist * Math.cos(bearing) - lateralWiggle * Math.sin(bearing)) / kmPerLat);
    const lng = start.lng +
      ((currentDist * Math.sin(bearing) + lateralWiggle * Math.cos(bearing)) / kmPerLng);

    outbound.push([lat, lng]);
  }

  // Return trip: return via slight alternative trail for cycling/running variety
  const inbound: [number, number][] = [];
  for (let i = outbound.length - 2; i >= 0; i--) {
    const p = outbound[i];
    // subtle offset on return
    const offsetLat = (Math.sin(i) * 0.0003);
    const offsetLng = (Math.cos(i) * 0.0003);
    inbound.push([p[0] + offsetLat, p[1] + offsetLng]);
  }
  // Finish exactly at start
  inbound.push([start.lat, start.lng]);

  return [...outbound, ...inbound];
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
  } = params;

  let rawCoordinates: [number, number][] = [];
  let confidenceScore: number | undefined = undefined;

  if (routeType === 'gps_art') {
    const glyphResult = generateGlyphPolyline(
      gpsArtText || 'RUN',
      startLocation,
      targetDistanceKm
    );
    rawCoordinates = glyphResult.coordinates;
    confidenceScore = glyphResult.confidenceScore;
  } else if (routeType === 'loop') {
    rawCoordinates = generateLoopRoute(startLocation, targetDistanceKm);
  } else {
    rawCoordinates = generateOutAndBackRoute(startLocation, targetDistanceKm);
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
