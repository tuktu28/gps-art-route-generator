import React, { useState, useEffect } from 'react';
import {
  ActivityType,
  DistanceUnit,
  ElevationPoint,
  ElevationPreference,
  GeneratedRoute,
  LatLng,
} from './types/route';
import { generateFullRoute } from './lib/routingEngine';
import { downloadGpxFile } from './lib/gpxExporter';
import { Map } from './components/Map';
import { ElevationChart } from './components/ElevationChart';
import { RouteForm } from './components/RouteForm';
import { MasterGuideModal } from './components/MasterGuideModal';
import {
  Activity,
  BookOpen,
  Clock,
  Download,
  Flame,
  Moon,
  Mountain,
  Sparkles,
  Sun,
} from 'lucide-react';

const DEFAULT_START_LOCATION: LatLng = {
  lat: 40.785091,
  lng: -73.968285, // Central Park, NYC
};

export default function App() {
  // Theme state (Light mode / Dark mode)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('wayline_theme');
      if (saved) return saved === 'dark';
      return false; // Default to natural light mode
    } catch {
      return false;
    }
  });

  // Sync theme with document class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('wayline_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('wayline_theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  // Application State
  const [currentRoute, setCurrentRoute] = useState<GeneratedRoute | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LatLng>(DEFAULT_START_LOCATION);
  const [selectedAddress, setSelectedAddress] = useState<string>('Central Park, NYC');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [unit, setUnit] = useState<DistanceUnit>('mi');

  // Elevation Hover Synchronization
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<ElevationPoint | null>(null);

  // Modals
  const [isGuideModalOpen, setIsGuideModalOpen] = useState<boolean>(false);

  // Generate Route Handler
  const handleGenerateRoute = async (params: {
    startLocation: LatLng;
    startingAddress: string;
    activity: ActivityType;
    routeType: any;
    targetDistanceKm: number;
    gpsArtText?: string;
    elevationPreference: ElevationPreference;
    unit: DistanceUnit;
  }) => {
    setIsLoading(true);
    try {
      await new Promise((res) => setTimeout(res, 300));

      const route = await generateFullRoute({
        startLocation: params.startLocation,
        startingAddress: params.startingAddress,
        activity: params.activity,
        routeType: params.routeType,
        targetDistanceKm: params.targetDistanceKm,
        gpsArtText: params.gpsArtText,
        elevationPreference: params.elevationPreference,
        unit: params.unit,
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

  return (
    <div className="min-h-screen bg-[#F8F6F0] dark:bg-[#121715] text-stone-800 dark:text-stone-100 flex flex-col font-sans transition-colors duration-200 selection:bg-[#2D4F3E] selection:text-white">
      {/* ================= HEADER NAVBAR ================= */}
      <header className="sticky top-0 z-50 w-full bg-[#FAF7F2]/95 dark:bg-[#161D1A]/95 border-b border-[#E5DFD3] dark:border-[#2E3C34] backdrop-blur-md px-4 lg:px-8 py-3.5 flex items-center justify-between transition-colors shadow-xs">
        {/* Brand Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#2D4F3E] dark:bg-[#3D6B56] flex items-center justify-center shadow-md shadow-[#2D4F3E]/20 text-white font-serif">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold font-serif tracking-wide text-stone-900 dark:text-stone-50">
                Wayline <span className="font-sans text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/30 text-[#2D4F3E] dark:text-[#7EB89B] border border-[#2D4F3E]/20">Route Studio</span>
              </h1>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 hidden sm:block">
              Curated Trails, Adaptive Street Loops & GPS Art Studio
            </p>
          </div>
        </div>

        {/* Action Controls & Theme Toggle */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* How-To Modal Button */}
          <button
            id="open-guide-btn"
            onClick={() => setIsGuideModalOpen(true)}
            title="How To Use Wayline"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E2723] border border-[#E5DFD3] dark:border-[#2E3C34] hover:border-[#2D4F3E]/40 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white shadow-xs text-xs font-semibold transition-all cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
            <span>How To</span>
          </button>

          {/* Light / Dark Mode Toggle */}
          <button
            id="theme-mode-toggle-btn"
            onClick={toggleTheme}
            title={isDarkMode ? 'Switch to Natural Light Mode' : 'Switch to Dark Forest Mode'}
            className="p-2 rounded-xl bg-white dark:bg-[#1E2723] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300 hover:text-[#2D4F3E] dark:hover:text-[#7EB89B] shadow-xs transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium"
          >
            {isDarkMode ? (
              <>
                <Sun className="w-4 h-4 text-[#DFBD84]" />
                <span className="hidden md:inline text-[11px]">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-[#2D4F3E]" />
                <span className="hidden md:inline text-[11px]">Dark</span>
              </>
            )}
          </button>

          {/* Distance Unit Toggle */}
          <button
            onClick={() => setUnit((prev) => (prev === 'mi' ? 'km' : 'mi'))}
            title="Toggle Distance Units (Miles / Kilometers)"
            className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#1E2723] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300 hover:text-[#2D4F3E] dark:hover:text-[#7EB89B] shadow-xs text-xs font-mono font-bold transition-all cursor-pointer"
          >
            {unit.toUpperCase()}
          </button>
        </div>
      </header>

      {/* ================= EDITORIAL HERO SECTION ================= */}
      <section className="w-full max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-2">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E5DFD3] dark:border-[#2E3C34] pb-5">
          <div className="flex flex-col gap-1.5">
            {/* Eyebrow */}
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-stone-600 dark:text-stone-400">
              <span className="w-2 h-2 rounded-full bg-[#D98A3C]" />
              <span>MAKE A WAYLINE</span>
            </div>

            {/* Poetic Serif Title */}
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold text-stone-900 dark:text-stone-50 tracking-tight leading-none">
              Go somewhere <span className="italic font-normal text-[#365D48] dark:text-[#7EB89B]">on purpose.</span>
            </h2>
          </div>

          {/* Editorial Note with Amber Bar */}
          <div className="max-w-md border-l-2 border-[#D98A3C] pl-3.5 py-0.5">
            <p className="text-xs sm:text-[13px] text-stone-600 dark:text-stone-300 italic font-serif leading-relaxed">
              Start with a few deliberate parameters. Preview the shape and export a route you&apos;ll want to go outside for.
            </p>
          </div>
        </div>
      </section>

      {/* ================= MAIN CONTENT WORKSPACE ================= */}
      <main className="flex-1 w-full max-w-[1700px] mx-auto p-3 sm:p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN: Route Designer Controls (4 cols on lg) */}
        <aside className="lg:col-span-4 flex flex-col">
          <div className="flex-1 flex flex-col p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-sm transition-colors">
            <div className="flex items-center justify-between border-b border-[#E5DFD3] dark:border-[#2E3C34] pb-3 mb-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#D98A3C] font-bold">ROUTE RECIPE</span>
                <h3 className="text-lg font-serif font-bold text-stone-900 dark:text-stone-100">Set the feeling.</h3>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#2D4F3E] dark:text-[#7EB89B] bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/20 px-2.5 py-1 rounded-full border border-[#2D4F3E]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2D4F3E] dark:bg-[#7EB89B] animate-pulse" />
                <span>{isLoading ? 'CALCULATING' : 'READY'}</span>
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
        </aside>

        {/* RIGHT COLUMN: Map, Telemetry HUD, & Elevation Chart (8 cols on lg) */}
        <section className="lg:col-span-8 flex flex-col gap-4 min-w-0">
          {/* Top Leaflet Map Section */}
          <div className="w-full h-[460px] sm:h-[520px] relative rounded-3xl overflow-hidden shadow-sm border border-[#E5DFD3] dark:border-[#2E3C34] group">
            {/* Floating Map Status Badges matching Screenshot */}
            <div className="absolute top-3.5 left-3.5 z-20 pointer-events-none flex items-center gap-2 flex-wrap">
              <div className="px-3 py-1 rounded-full bg-[#FAF7F2]/95 dark:bg-[#161D1A]/95 border border-[#E5DFD3] dark:border-[#2E3C34] shadow-md backdrop-blur-sm text-[11px] font-mono font-bold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <span className="text-[#365D48] dark:text-[#7EB89B]">PREVIEW / 01</span>
                <span className="text-stone-400 dark:text-stone-600">•</span>
                <span>
                  {currentRoute
                    ? `${unit === 'km' ? currentRoute.stats.distanceKm : currentRoute.stats.distanceMi} ${unit} ${currentRoute.routeType.replace('_', ' ')}`
                    : `Set trailhead & distance`}
                </span>
              </div>

              <div className="px-2.5 py-1 rounded-full bg-[#FAF7F2]/95 dark:bg-[#161D1A]/95 border border-[#E5DFD3] dark:border-[#2E3C34] shadow-md backdrop-blur-sm text-[10px] font-mono text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D98A3C]" />
                <span className="uppercase font-semibold">{currentRoute ? 'ACTIVE ROUTE' : 'DRAG PIN TO MOVE'}</span>
              </div>

              {currentRoute?.terrainFocus && (
                <div className="px-2.5 py-1 rounded-full bg-[#FAF7F2]/95 dark:bg-[#161D1A]/95 border border-[#E5DFD3] dark:border-[#2E3C34] shadow-md backdrop-blur-sm text-[10px] font-mono text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                  <span className="font-semibold text-[#2D4F3E] dark:text-[#7EB89B]">{currentRoute.terrainFocus}</span>
                </div>
              )}
            </div>

            <Map
              route={currentRoute}
              hoveredElevationPoint={hoveredElevationPoint}
              onMapClick={handleMapClick}
              selectedLocation={selectedLocation}
              isDarkMode={isDarkMode}
            />
          </div>

          {/* Active Route Telemetry & Action Bar */}
          {currentRoute ? (
            <div
              id="route-telemetry-bar"
              className="p-4 rounded-2xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full sm:w-auto font-mono text-xs">
                {/* Distance */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">Distance</span>
                  <span className="text-base font-bold text-[#2D4F3E] dark:text-[#7EB89B]">
                    {unit === 'km' ? currentRoute.stats.distanceKm : currentRoute.stats.distanceMi}{' '}
                    <span className="text-xs text-stone-500">{unit}</span>
                  </span>
                </div>

                {/* Duration */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">Est. Duration</span>
                  <span className="text-base font-bold text-stone-800 dark:text-stone-100 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#8C6838] dark:text-[#DFBD84]" />
                    {currentRoute.stats.estimatedDurationMinutes}m
                  </span>
                </div>

                {/* Elevation */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">Climb Gain</span>
                  <span className="text-base font-bold text-stone-800 dark:text-stone-100 flex items-center gap-1">
                    <Mountain className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
                    +{currentRoute.stats.elevationGainM}m
                  </span>
                </div>

                {/* Calories / Confidence */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                    {currentRoute.routeType === 'gps_art' ? 'Art Precision' : 'Est. Calories'}
                  </span>
                  {currentRoute.routeType === 'gps_art' ? (
                    <span className="text-base font-bold text-[#8C6838] dark:text-[#DFBD84] flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-[#8C6838] dark:text-[#DFBD84]" />
                      {currentRoute.stats.confidenceScore}%
                    </span>
                  ) : (
                    <span className="text-base font-bold text-[#C86432] flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-[#C86432]" />
                      {currentRoute.stats.estimatedCalories} kcal
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-[#E5DFD3] dark:border-[#2E3C34]">
                {/* Download GPX CTA */}
                <button
                  id="download-gpx-btn"
                  onClick={() => downloadGpxFile(currentRoute)}
                  className="px-4 py-2 rounded-xl bg-[#2D4F3E] hover:bg-[#233F31] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
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
      {/* 1. Master Blueprint Guide Modal */}
      <MasterGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />
    </div>
  );
}
