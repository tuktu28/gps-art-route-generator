import { SavedRoute, GeneratedRoute } from '../types/route';

/**
 * Supabase client and storage bridge
 * Connects to Supabase PostGIS backend when configured, or provides instant LocalStorage fallback.
 */

const STORAGE_KEY = 'gps_art_saved_routes_v1';

export function getSavedRoutesFromLocal(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading local routes:', err);
    return [];
  }
}

export function saveRouteToLocal(route: GeneratedRoute): SavedRoute {
  const routes = getSavedRoutesFromLocal();
  const newSavedRoute: SavedRoute = {
    ...route,
    isFavorite: false,
  };
  const updated = [newSavedRoute, ...routes.filter(r => r.id !== route.id)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return newSavedRoute;
}

export function deleteRouteFromLocal(id: string): void {
  const routes = getSavedRoutesFromLocal();
  const updated = routes.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function updateRouteInLocal(id: string, updates: Partial<SavedRoute>): SavedRoute | null {
  const routes = getSavedRoutesFromLocal();
  let updatedRoute: SavedRoute | null = null;
  const updated = routes.map(r => {
    if (r.id === id) {
      updatedRoute = { ...r, ...updates };
      return updatedRoute;
    }
    return r;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updatedRoute;
}

/**
 * Supabase SQL Integration Helper
 * Provides copyable templates and API helper logic for Section 5
 */
export async function saveRouteToSupabase(
  route: GeneratedRoute,
  supabaseUrl?: string,
  supabaseKey?: string,
  userId?: string
): Promise<{ success: boolean; message: string; data?: any }> {
  // Always persist to local cache first
  const local = saveRouteToLocal(route);

  if (!supabaseUrl || !supabaseKey) {
    return {
      success: true,
      message: 'Saved to Local Cache (Configure Supabase credentials in Settings to sync with PostGIS)',
      data: local,
    };
  }

  try {
    // Generate WKT (Well-Known Text) LineString for PostGIS: 'LINESTRING(lng lat, lng lat, ...)'
    // Note: PostGIS standard coordinate order in WKT is X Y (Longitude Latitude)
    const wktCoords = route.coordinates
      .map(([lat, lng]) => `${lng.toFixed(6)} ${lat.toFixed(6)}`)
      .join(', ');
    const wktLineString = `LINESTRING(${wktCoords})`;

    const response = await fetch(`${supabaseUrl}/rest/v1/routes`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        name: route.name,
        activity: route.activity,
        route_type: route.routeType,
        gps_art_text: route.gpsArtText || null,
        distance_km: route.stats.distanceKm,
        elevation_gain_m: route.stats.elevationGainM,
        elevation_loss_m: route.stats.elevationLossM,
        elevation_profile_json: route.elevationProfile,
        privacy_strategy: route.privacy.strategy,
        raw_geom_wkt: wktLineString,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return {
      success: true,
      message: 'Route synced directly to Supabase PostGIS database with spatial privacy masking applied!',
      data,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Supabase sync failed: ${err.message}. Route saved in local cache.`,
      data: local,
    };
  }
}
