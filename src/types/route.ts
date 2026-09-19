export type ActivityType = 'run' | 'road_bike' | 'mountain_bike' | 'bike' | 'hike';
export type RouteType = 'loop' | 'out_and_back' | 'gps_art';
export type DistanceUnit = 'km' | 'mi';
export type ElevationPreference = 'flat' | 'moderate' | 'hilly';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ElevationPoint {
  distance: number; // in km or mi
  elevation: number; // in meters
  grade?: number; // in percentage
  lat: number;
  lng: number;
}

export interface RouteStats {
  distanceKm: number;
  distanceMi: number;
  elevationGainM: number;
  elevationLossM: number;
  estimatedDurationMinutes: number;
  estimatedCalories: number;
  confidenceScore?: number; // for GPS Art matching
  turnCount: number;
  highestPointM: number;
  lowestPointM: number;
  safeCrossingCount?: number;
}

export interface SafeCrossing {
  lat: number;
  lng: number;
  type: 'traffic_signals' | 'stop' | 'marked_crossing';
  name?: string;
  roadName?: string;
}

export interface TechnicalSegmentWarning {
  lat: number;
  lng: number;
  mtbScale: number;
  name?: string;
  description: string;
}

export interface PrivacyMaskInfo {
  applied: boolean;
  strategy: 'truncate_500m' | 'jitter_500m' | 'none';
  originalStart: LatLng;
  maskedStart: LatLng;
  originalEnd: LatLng;
  maskedEnd: LatLng;
  bufferRadiusMeters: number;
}

export interface GeneratedRoute {
  id: string;
  name: string;
  activity: ActivityType;
  routeType: RouteType;
  gpsArtText?: string;
  coordinates: [number, number][]; // [lat, lng] array for Leaflet
  elevationProfile: ElevationPoint[];
  stats: RouteStats;
  privacy: PrivacyMaskInfo;
  safeCrossings?: SafeCrossing[];
  technicalWarnings?: TechnicalSegmentWarning[];
  gravelFallbackUsed?: boolean;
  terrainFocus?: string;
  surfaceType?: string;
  createdAt: string;
  startingAddress: string;
}

export interface SavedRoute extends GeneratedRoute {
  userId?: string;
  isFavorite?: boolean;
  notes?: string;
}

export interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
}

export interface ApiConfiguration {
  openRouteServiceKey?: string;
  fastApiEndpointUrl?: string;
  sentryDsn?: string;
}
