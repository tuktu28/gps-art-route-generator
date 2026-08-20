import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityType,
  DistanceUnit,
  ElevationPreference,
  LatLng,
  NominatimResult,
  RouteType,
} from '../types/route';
import {
  AlertTriangle,
  Bike,
  Compass,
  Footprints,
  Heart,
  Info,
  Loader2,
  Locate,
  MapPin,
  Mountain,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Type,
  Zap,
} from 'lucide-react';

interface RouteFormProps {
  onGenerate: (params: {
    startLocation: LatLng;
    startingAddress: string;
    activity: ActivityType;
    routeType: RouteType;
    targetDistanceKm: number;
    gpsArtText?: string;
    routeName?: string;
    elevationPreference: ElevationPreference;
    privacyMaskingEnabled: boolean;
    unit: DistanceUnit;
  }) => Promise<void>;
  isLoading: boolean;
  selectedLocation: LatLng;
  onLocationChange: (loc: LatLng, address: string) => void;
  unit: DistanceUnit;
  onUnitChange: (unit: DistanceUnit) => void;
}

const PRESET_CITIES = [
  { name: 'Central Park, NYC', lat: 40.785091, lng: -73.968285 },
  { name: 'Hyde Park, London', lat: 51.507268, lng: -0.165730 },
  { name: 'Golden Gate, San Francisco', lat: 37.802375, lng: -122.405823 },
  { name: 'Seine River, Paris', lat: 48.856614, lng: 2.352222 },
  { name: 'Boulder Trails, Colorado', lat: 40.014986, lng: -105.270546 },
  { name: 'Yoyogi Park, Tokyo', lat: 35.671989, lng: 139.696372 },
];

const GPS_ART_PRESETS = [
  'RUNNING',
  '5K',
  'RUN',
  'HEART',
  'STAR',
  'BIKE',
  'PEACE',
  'FAST',
  'TRAIL',
];

export const RouteForm: React.FC<RouteFormProps> = ({
  onGenerate,
  isLoading,
  selectedLocation,
  onLocationChange,
  unit,
  onUnitChange,
}) => {
  // Form States
  const [addressQuery, setAddressQuery] = useState<string>('Central Park, NYC');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [activity, setActivity] = useState<ActivityType>('run');
  const [routeType, setRouteType] = useState<RouteType>('loop');
  const [gpsArtText, setGpsArtText] = useState<string>('RUNNING');
  const [distanceValue, setDistanceValue] = useState<number>(5.0);
  const [routeName, setRouteName] = useState<string>('');
  const [elevationPreference, setElevationPreference] = useState<ElevationPreference>('moderate');
  const [privacyMaskingEnabled, setPrivacyMaskingEnabled] = useState<boolean>(true);

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced Nominatim Address Geocoding
  const handleAddressInputChange = (val: string) => {
    setAddressQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (val.trim().length < 3) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            val
          )}&limit=5&addressdetails=1`
        );
        if (response.ok) {
          const data: NominatimResult[] = await response.json();
          setSearchResults(data);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error('Geocoding error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 450);
  };

  const handleSelectNominatimResult = (res: NominatimResult) => {
    const lat = parseFloat(res.lat);
    const lng = parseFloat(res.lon);
    onLocationChange({ lat, lng }, res.display_name);
    setAddressQuery(res.display_name.split(',')[0]);
    setShowDropdown(false);
  };

  const handleSelectPreset = (city: { name: string; lat: number; lng: number }) => {
    onLocationChange({ lat: city.lat, lng: city.lng }, city.name);
    setAddressQuery(city.name);
    setShowDropdown(false);
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        onLocationChange({ lat, lng }, 'Current Device Location');
        setAddressQuery(`GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      },
      (err) => {
        alert(`Geolocation failed: ${err.message}`);
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const distanceInKm = unit === 'km' ? distanceValue : distanceValue * 1.60934;

    await onGenerate({
      startLocation: selectedLocation,
      startingAddress: addressQuery,
      activity,
      routeType,
      targetDistanceKm: distanceInKm,
      gpsArtText: routeType === 'gps_art' ? gpsArtText : undefined,
      routeName: routeName.trim() || undefined,
      elevationPreference,
      privacyMaskingEnabled,
      unit,
    });
  };

  return (
    <form
      id="route-generator-form"
      onSubmit={handleSubmit}
      className="flex flex-col gap-4.5 text-slate-100"
    >
      {/* 1. Address Search / Starting Location */}
      <div className="relative flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            Starting Location
          </span>
          <button
            type="button"
            onClick={handleGeolocate}
            id="geolocate-me-btn"
            className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
          >
            <Locate className="w-3 h-3" /> Use My GPS
          </button>
        </label>

        <div className="relative">
          <input
            type="text"
            id="address-search-input"
            value={addressQuery}
            onChange={(e) => handleAddressInputChange(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
            placeholder="Search address, park, or landmark..."
            className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          {isSearching && (
            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin absolute right-3 top-3" />
          )}
        </div>

        {/* Quick presets row */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">Hotspots:</span>
          {PRESET_CITIES.map((city) => (
            <button
              key={city.name}
              type="button"
              onClick={() => handleSelectPreset(city)}
              className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-[10px] text-slate-300 whitespace-nowrap border border-slate-700 transition-colors"
            >
              {city.name.split(',')[0]}
            </button>
          ))}
        </div>

        {/* Nominatim Search Dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-16 left-0 right-0 z-50 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1 backdrop-blur-lg flex flex-col gap-0.5 max-h-56 overflow-y-auto">
            {searchResults.map((res) => (
              <button
                key={res.place_id}
                type="button"
                onClick={() => handleSelectNominatimResult(res)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-slate-800 hover:text-emerald-400 transition-colors flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span className="truncate">{res.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Activity Selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-slate-300">Activity Type</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'run', label: 'Run', icon: Footprints, color: 'text-emerald-400' },
              { id: 'bike', label: 'Bike', icon: Bike, color: 'text-cyan-400' },
              { id: 'hike', label: 'Hike', icon: Mountain, color: 'text-amber-400' },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isSelected = activity === item.id;
            return (
              <button
                key={item.id}
                type="button"
                id={`activity-btn-${item.id}`}
                onClick={() => setActivity(item.id)}
                className={`py-2.5 px-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-slate-800 border-emerald-500/80 shadow-md ring-1 ring-emerald-500/40 text-white'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${isSelected ? item.color : 'text-slate-400'}`} />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Route Type Selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-slate-300">Route Geometry</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'loop', label: 'Loop', icon: RefreshCw },
              { id: 'out_and_back', label: 'Out & Back', icon: Compass },
              { id: 'gps_art', label: 'GPS Art', icon: Sparkles },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isSelected = routeType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                id={`route-type-btn-${item.id}`}
                onClick={() => setRouteType(item.id)}
                className={`py-2.5 px-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                  isSelected
                    ? item.id === 'gps_art'
                      ? 'bg-purple-950/40 border-purple-500 text-purple-200 shadow-md ring-1 ring-purple-500/50'
                      : 'bg-slate-800 border-emerald-500/80 shadow-md ring-1 ring-emerald-500/40 text-white'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    isSelected
                      ? item.id === 'gps_art'
                        ? 'text-purple-400 animate-pulse'
                        : 'text-emerald-400'
                      : 'text-slate-400'
                  }`}
                />
                <span className="text-xs font-medium whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. CONDITIONAL LOGIC: GPS Art Text Input & Warning */}
      {routeType === 'gps_art' ? (
        <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-800/50 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-purple-400" />
              GPS Art Word / Shape
            </label>
            <input
              type="text"
              id="gps-art-text-input"
              value={gpsArtText}
              onChange={(e) => setGpsArtText(e.target.value.toUpperCase())}
              placeholder="e.g. RUNNING, 5K, HEART"
              maxLength={12}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-700/60 text-sm font-mono font-bold tracking-wider text-purple-200 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 uppercase"
            />
          </div>

          {/* Quick preset glyph words */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-purple-400/80 font-medium">Quick Art:</span>
            {GPS_ART_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setGpsArtText(preset)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono border transition-all ${
                  gpsArtText === preset
                    ? 'bg-purple-600 text-white border-purple-400 font-bold'
                    : 'bg-purple-900/40 text-purple-300 border-purple-800 hover:bg-purple-800/50'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Explicit Warning Notice Required by Master Spec */}
          <div className="p-2.5 rounded-xl bg-purple-900/30 border border-purple-700/40 text-[11px] text-purple-300/90 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-amber-300">Notice:</strong> GPS Art uses best-effort spatial fitting and depends on local street grids. Try shifting your start point if results vary.
            </p>
          </div>
        </div>
      ) : null}

      {/* 5. Target Distance & Units Toggle */}
      <div className="flex flex-col gap-2 p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-300">
            Target Distance
          </label>
          <div className="flex items-center rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            <button
              type="button"
              id="unit-km-btn"
              onClick={() => onUnitChange('km')}
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-semibold transition-colors ${
                unit === 'km' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              KM
            </button>
            <button
              type="button"
              id="unit-mi-btn"
              onClick={() => onUnitChange('mi')}
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-semibold transition-colors ${
                unit === 'mi' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              MILES
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={unit === 'km' ? 50 : 31}
            step={0.5}
            value={distanceValue}
            onChange={(e) => setDistanceValue(parseFloat(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
          />
          <div className="w-16 shrink-0 flex items-center justify-end font-mono text-sm font-bold text-emerald-400">
            {distanceValue.toFixed(1)} {unit}
          </div>
        </div>
      </div>

      {/* 6. Optional Route Name & Elevation Tendency */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-slate-400">Route Name (Optional)</label>
          <input
            type="text"
            id="route-name-input"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            placeholder="e.g. Morning Pace Run"
            className="w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-slate-400">Terrain Profile</label>
          <select
            id="terrain-profile-select"
            value={elevationPreference}
            onChange={(e) => setElevationPreference(e.target.value as ElevationPreference)}
            className="w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="flat">Flat (~5-15m)</option>
            <option value="moderate">Moderate Rolling</option>
            <option value="hilly">Hilly Climbs</option>
          </select>
        </div>
      </div>

      {/* 7. Privacy & PostGIS Masking Toggle */}
      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${privacyMaskingEnabled ? 'text-blue-400' : 'text-slate-500'}`} />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-200">PostGIS Privacy Masking</span>
            <span className="text-[10px] text-slate-400">
              {distanceValue > (unit === 'km' ? 5 : 3.1)
                ? '500m start/end truncation (>5km)'
                : '500m spatial jitter (≤5km)'}
            </span>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            id="privacy-masking-checkbox"
            checked={privacyMaskingEnabled}
            onChange={(e) => setPrivacyMaskingEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* 8. Generate Route CTA Button */}
      <button
        type="submit"
        id="generate-route-submit-btn"
        disabled={isLoading}
        className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-sm tracking-wide shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
            <span>Calculating Spatial Graph...</span>
          </>
        ) : (
          <>
            <Zap className="w-4 h-4 fill-slate-950" />
            <span>
              {routeType === 'gps_art' ? `Generate "${gpsArtText || 'RUN'}" GPS Art` : 'Generate Optimal Route'}
            </span>
          </>
        )}
      </button>
    </form>
  );
};
