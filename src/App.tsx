import React, { useState, useEffect } from 'react';
import {
  ActivityType,
  ApiConfiguration,
  DistanceUnit,
  ElevationPoint,
  ElevationPreference,
  GeneratedRoute,
  LatLng,
  SavedRoute,
} from './types/route';
import { generateFullRoute } from './lib/routingEngine';
import { downloadGpxFile } from './lib/gpxExporter';
import {
  getSavedRoutesFromLocal,
  saveRouteToLocal,
  deleteRouteFromLocal,
  updateRouteInLocal,
  saveRouteToSupabase,
} from './lib/supabaseClient';
import { Map } from './components/Map';
import { ElevationChart } from './components/ElevationChart';
import { RouteForm } from './components/RouteForm';
import { SavedRoutesModal } from './components/SavedRoutesModal';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { MasterGuideModal } from './components/MasterGuideModal';
import {
  Activity,
  Bookmark,
  BookOpen,
  Check,
  Clock,
  Compass,
  Download,
  Flame,
  Footprints,
  Layers,
  MapPin,
  Mountain,
  Navigation,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';

const DEFAULT_START_LOCATION: LatLng = {
  lat: 40.785091,
  lng: -73.968285, // Central Park, NYC
};

export default function App() {
  // Application State
  const [currentRoute, setCurrentRoute] = useState<GeneratedRoute | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LatLng>(DEFAULT_START_LOCATION);
  const [selectedAddress, setSelectedAddress] = useState<string>('Central Park, NYC');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [unit, setUnit] = useState<DistanceUnit>('km');

  // Elevation Hover Synchronization
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<ElevationPoint | null>(null);

  // Saved Routes
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [isSavedModalOpen, setIsSavedModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState<boolean>(false);

  // Save feedback state
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // API Configuration state
  const [apiConfig, setApiConfig] = useState<ApiConfiguration>(() => {
    try {
      const stored = localStorage.getItem('gps_art_api_config');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Load initial saved routes from local storage
  useEffect(() => {
    setSavedRoutes(getSavedRoutesFromLocal());
  }, []);

  // Save API config to storage
  const handleSaveApiConfig = (newCfg: ApiConfiguration) => {
    setApiConfig(newCfg);
    localStorage.setItem('gps_art_api_config', JSON.stringify(newCfg));
  };

  // Generate Route Handler
  const handleGenerateRoute = async (params: {
    startLocation: LatLng;
    startingAddress: string;
    activity: ActivityType;
    routeType: any;
    targetDistanceKm: number;
    gpsArtText?: string;
    routeName?: string;
    elevationPreference: ElevationPreference;
    privacyMaskingEnabled: boolean;
    unit: DistanceUnit;
  }) => {
    setIsLoading(true);
    try {
      // Simulate microservice / ORS network latency for realism
      await new Promise((res) => setTimeout(res, 600));

      const route = await generateFullRoute({
        startLocation: params.startLocation,
        startingAddress: params.startingAddress,
        activity: params.activity,
        routeType: params.routeType,
        targetDistanceKm: params.targetDistanceKm,
        gpsArtText: params.gpsArtText,
        routeName: params.routeName,
        elevationPreference: params.elevationPreference,
        privacyMaskingEnabled: params.privacyMaskingEnabled,
        unit: params.unit,
        apiConfig,
      });

      setCurrentRoute(route);
    } catch (err: any) {
      console.error('Route generation error:', err);
      alert(`Error creating route: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle map click to set start location
  const handleMapClick = (latLng: LatLng) => {
    setSelectedLocation(latLng);
    setSelectedAddress(`Pin Location (${latLng.lat.toFixed(4)}, ${latLng.lng.toFixed(4)})`);
  };

  // Save Current Route
  const handleSaveCurrentRoute = async () => {
    if (!currentRoute) return;

    setSaveStatus('Saving to Database...');
    const res = await saveRouteToSupabase(
      currentRoute,
      apiConfig.supabaseUrl,
      apiConfig.supabaseAnonKey
    );

    setSavedRoutes(getSavedRoutesFromLocal());
    setSaveStatus('Route Saved!');
    setTimeout(() => setSaveStatus(null), 2500);
  };

  // Delete Route
  const handleDeleteRoute = (id: string) => {
    deleteRouteFromLocal(id);
    setSavedRoutes(getSavedRoutesFromLocal());
  };

  // Rename / Update Route
  const handleUpdateRoute = (id: string, updates: Partial<SavedRoute>) => {
    updateRouteInLocal(id, updates);
    setSavedRoutes(getSavedRoutesFromLocal());
  };

  // Load Saved Route to Active Canvas
  const handleLoadSavedRoute = (route: GeneratedRoute) => {
    setCurrentRoute(route);
    if (route.coordinates.length > 0) {
      setSelectedLocation({
        lat: route.coordinates[0][0],
        lng: route.coordinates[0][1],
      });
      setSelectedAddress(route.startingAddress || 'Saved Route Starting Point');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950 font-sans">
      {/* ================= HEADER NAVBAR ================= */}
      <header className="sticky top-0 z-40 w-full bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-xl px-4 lg:px-8 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-slate-950 font-extrabold text-lg">
            <Compass className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-black tracking-tight text-white">
                ROUTECRAFT <span className="text-emerald-400">SPATIAL</span>
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-mono font-bold border border-purple-500/30">
                GPS ART ENGINE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Privacy-First Route Generator & PostGIS Spatial Mesh
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Master Deployment Guide CTA */}
          <button
            id="open-master-guide-btn"
            onClick={() => setIsGuideModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-purple-600/25 transition-all cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Master Blueprint</span>
            <span className="md:hidden">Guide</span>
          </button>

          {/* Saved Routes Library */}
          <button
            id="open-saved-routes-btn"
            onClick={() => setIsSavedModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Library</span>
            {savedRoutes.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-mono font-bold">
                {savedRoutes.length}
              </span>
            )}
          </button>

          {/* Settings Modal */}
          <button
            id="open-api-settings-btn"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Configure APIs & Microservice"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-all"
          >
            <Sliders className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </header>

      {/* ================= MAIN CONTENT WORKSPACE ================= */}
      <main className="flex-1 w-full max-w-[1700px] mx-auto p-3 sm:p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN: Route Designer Controls (4 cols on lg) */}
        <aside className="lg:col-span-4 flex flex-col gap-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-xl shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Route Architect
                  </h2>
                  <p className="text-[11px] text-slate-400">Configure parameters & spatial fit</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>ONLINE</span>
              </div>
            </div>

            {/* Main Interactive Form */}
            <RouteForm
              onGenerate={handleGenerateRoute}
              isLoading={isLoading}
              selectedLocation={selectedLocation}
              onLocationChange={(loc, addr) => {
                setSelectedLocation(loc);
                setSelectedAddress(addr);
              }}
              unit={unit}
              onUnitChange={setUnit}
            />
          </div>

          {/* Privacy & SOC2 Architectural Card */}
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>Spatial Privacy & PII Protection</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              PostGIS spatial engine automatically masks user doorstep origins: routes &gt;5km are truncated 500m from start/end; routes &le;5km apply 500m spatial jitter to prevent personal location leakage.
            </p>
          </div>
        </aside>

        {/* RIGHT COLUMN: Map, Telemetry HUD, & Elevation Chart (8 cols on lg) */}
        <section className="lg:col-span-8 flex flex-col gap-4 min-w-0">
          {/* Top Leaflet Map Section */}
          <div className="w-full h-[460px] sm:h-[500px] relative">
            <Map
              route={currentRoute}
              hoveredElevationPoint={hoveredElevationPoint}
              onMapClick={handleMapClick}
              selectedLocation={selectedLocation}
              showPrivacyBuffer={true}
            />
          </div>

          {/* Active Route Telemetry & Action Bar */}
          {currentRoute ? (
            <div
              id="route-telemetry-bar"
              className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full sm:w-auto font-mono text-xs">
                {/* Distance */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase">Distance</span>
                  <span className="text-base font-bold text-emerald-400">
                    {unit === 'km' ? currentRoute.stats.distanceKm : currentRoute.stats.distanceMi}{' '}
                    <span className="text-xs text-slate-400">{unit}</span>
                  </span>
                </div>

                {/* Duration */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase">Est. Duration</span>
                  <span className="text-base font-bold text-slate-100 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    {currentRoute.stats.estimatedDurationMinutes}m
                  </span>
                </div>

                {/* Elevation */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase">Climb Gain</span>
                  <span className="text-base font-bold text-slate-100 flex items-center gap-1">
                    <Mountain className="w-3.5 h-3.5 text-amber-400" />
                    +{currentRoute.stats.elevationGainM}m
                  </span>
                </div>

                {/* Calories / Confidence */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase">
                    {currentRoute.routeType === 'gps_art' ? 'Art Match Fit' : 'Est. Burn'}
                  </span>
                  {currentRoute.routeType === 'gps_art' ? (
                    <span className="text-base font-bold text-purple-400 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      {currentRoute.stats.confidenceScore}%
                    </span>
                  ) : (
                    <span className="text-base font-bold text-rose-400 flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-rose-400" />
                      {currentRoute.stats.estimatedCalories} kcal
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800">
                {/* Save Route CTA */}
                <button
                  id="save-route-to-db-btn"
                  onClick={handleSaveCurrentRoute}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  {saveStatus ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{saveStatus}</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Save Route</span>
                    </>
                  )}
                </button>

                {/* Download GPX CTA */}
                <button
                  id="download-gpx-btn"
                  onClick={() => downloadGpxFile(currentRoute)}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Export .GPX</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* Bottom Synced Elevation Chart */}
          <ElevationChart
            profile={currentRoute?.elevationProfile || []}
            stats={
              currentRoute?.stats || {
                distanceKm: 0,
                distanceMi: 0,
                elevationGainM: 0,
                elevationLossM: 0,
                estimatedDurationMinutes: 0,
                estimatedCalories: 0,
                turnCount: 0,
                highestPointM: 0,
                lowestPointM: 0,
              }
            }
            unit={unit}
            onHoverPoint={setHoveredElevationPoint}
            hoveredPoint={hoveredElevationPoint}
          />
        </section>
      </main>

      {/* ================= MODALS ================= */}
      {/* 1. Saved Routes Library Modal */}
      <SavedRoutesModal
        isOpen={isSavedModalOpen}
        onClose={() => setIsSavedModalOpen(false)}
        savedRoutes={savedRoutes}
        onSelectRoute={handleLoadSavedRoute}
        onDeleteRoute={handleDeleteRoute}
        onUpdateRoute={handleUpdateRoute}
      />

      {/* 2. API & Microservice Settings Modal */}
      <ApiSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={apiConfig}
        onSaveConfig={handleSaveApiConfig}
      />

      {/* 3. Master Blueprint Guide Modal (Sections 1-5) */}
      <MasterGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />
    </div>
  );
}
