export type ActivityType = 'run' | 'bike' | 'hike';
export type RouteType = 'loop' | 'out_and_back' | 'gps_art' | 'manual';
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
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  sentryDsn?: string;
}
