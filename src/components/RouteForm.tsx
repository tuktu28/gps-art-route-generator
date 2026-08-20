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
  Info,
  Loader2,
  Locate,
  MapPin,
  Mountain,
  Plus,
  Minus,
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

  // Sync address if selectedLocation is changed externally (e.g. via map click)
  useEffect(() => {
    // When location updates without an explicit addressQuery match
    if (addressQuery.startsWith('Pin (') || addressQuery.startsWith('GPS (')) {
      setAddressQuery(`Pin (${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)})`);
    }
  }, [selectedLocation]);

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

          // Auto-center map if exact or high-confidence match is found
          if (data && data.length > 0) {
            const firstLat = parseFloat(data[0].lat);
            const firstLng = parseFloat(data[0].lon);
            if (!isNaN(firstLat) && !isNaN(firstLng)) {
              onLocationChange({ lat: firstLat, lng: firstLng }, data[0].display_name);
            }
          }
        }
      } catch (err) {
        console.error('Geocoding error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 450);
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      handleSelectNominatimResult(searchResults[0]);
    }
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

  const adjustDistance = (delta: number) => {
    setDistanceValue((prev) => {
      const next = Math.max(0.5, Math.min(100, parseFloat((prev + delta).toFixed(1))));
      return next;
    });
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

  // Preset Distance Chips (including 20 miles and 26.2 marathon miles)
  const distancePresets = unit === 'mi'
    ? [3.1, 5.0, 6.2, 10.0, 13.1, 20.0, 26.2]
    : [5.0, 8.0, 10.0, 15.0, 21.1, 32.2, 42.2];

  return (
    <form
      id="route-generator-form"
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 text-[#1E2A24] dark:text-[#E8EAE6]"
    >
      {/* 1. Address Search / Starting Location */}
      <div className="relative flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-[#C86432]" />
            Starting Location
          </span>
          <button
            type="button"
            onClick={handleGeolocate}
            id="geolocate-me-btn"
            className="text-[11px] text-[#2D4F3E] dark:text-[#7EB89B] hover:underline flex items-center gap-1 transition-colors cursor-pointer font-medium"
          >
            <Locate className="w-3 h-3 text-[#C86432]" /> Use My GPS
          </button>
        </label>

        <div className="relative">
          <input
            type="text"
            id="address-search-input"
            value={addressQuery}
            onChange={(e) => handleAddressInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
            placeholder="Search address, park, or click on map..."
            className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs text-[#1E2A24] dark:text-[#E8EAE6] placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-[#2D4F3E] dark:focus:border-[#5C8E76] focus:ring-1 focus:ring-[#2D4F3E] dark:focus:ring-[#5C8E76] transition-all shadow-sm"
          />
          <Search className="w-4 h-4 text-stone-400 dark:text-stone-500 absolute left-3 top-3 pointer-events-none" />
          {isSearching && (
            <Loader2 className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B] animate-spin absolute right-3 top-3" />
          )}
        </div>

        {/* Quick hotspots row */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          <span className="text-[10px] text-stone-500 dark:text-stone-400 font-medium whitespace-nowrap">Hotspots:</span>
          {PRESET_CITIES.map((city) => (
            <button
              key={city.name}
              type="button"
              onClick={() => handleSelectPreset(city)}
              className="px-2 py-0.5 rounded-md bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-[#EAE4D7] dark:hover:bg-[#324038] text-[10px] text-stone-700 dark:text-stone-300 whitespace-nowrap border border-[#E5DFD3] dark:border-[#2E3C34] transition-colors cursor-pointer"
            >
              {city.name.split(',')[0]}
            </button>
          ))}
        </div>

        {/* Nominatim Search Dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-16 left-0 right-0 z-50 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-xl p-1 backdrop-blur-lg flex flex-col gap-0.5 max-h-56 overflow-y-auto">
            {searchResults.map((res) => (
              <button
                key={res.place_id}
                type="button"
                onClick={() => handleSelectNominatimResult(res)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-stone-700 dark:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] hover:text-[#2D4F3E] dark:hover:text-[#7EB89B] transition-colors flex items-start gap-2 cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                <span className="truncate">{res.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Activity Selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Activity Type</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'run', label: 'Run', icon: Footprints, color: 'text-[#2D4F3E] dark:text-[#7EB89B]' },
              { id: 'bike', label: 'Bike', icon: Bike, color: 'text-[#C86432]' },
              { id: 'hike', label: 'Hike', icon: Mountain, color: 'text-[#8C6838]' },
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
                className={`py-2.5 px-3 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 border-[#2D4F3E] dark:border-[#5C8E76] shadow-sm text-[#2D4F3E] dark:text-[#E8EAE6] font-semibold'
                    : 'bg-white dark:bg-[#19201D] border-[#E5DFD3] dark:border-[#2E3C34] text-stone-600 dark:text-stone-400 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isSelected ? item.color : 'text-stone-400'}`} />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Route Type Selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Route Geometry</label>
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
                className={`py-2.5 px-2 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  isSelected
                    ? item.id === 'gps_art'
                      ? 'bg-[#8A4A72]/10 dark:bg-[#8A4A72]/25 border-[#8A4A72] text-[#8A4A72] dark:text-[#E1B8D4] font-semibold'
                      : 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 border-[#2D4F3E] dark:border-[#5C8E76] shadow-sm text-[#2D4F3E] dark:text-[#E8EAE6] font-semibold'
                    : 'bg-white dark:bg-[#19201D] border-[#E5DFD3] dark:border-[#2E3C34] text-stone-600 dark:text-stone-400 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    isSelected
                      ? item.id === 'gps_art'
                        ? 'text-[#8A4A72] dark:text-[#E1B8D4]'
                        : 'text-[#2D4F3E] dark:text-[#7EB89B]'
                      : 'text-stone-400'
                  }`}
                />
                <span className="text-xs whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. CONDITIONAL LOGIC: GPS Art Text Input & Warning */}
      {routeType === 'gps_art' ? (
        <div className="p-3.5 rounded-2xl bg-[#8A4A72]/10 dark:bg-[#8A4A72]/20 border border-[#8A4A72]/30 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[#8A4A72] dark:text-[#E1B8D4] flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-[#8A4A72] dark:text-[#E1B8D4]" />
              GPS Art Word / Shape
            </label>
            <input
              type="text"
              id="gps-art-text-input"
              value={gpsArtText}
              onChange={(e) => setGpsArtText(e.target.value.toUpperCase())}
              placeholder="e.g. RUNNING, 5K, HEART"
              maxLength={12}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#19201D] border border-[#8A4A72]/40 text-sm font-mono font-bold tracking-wider text-[#8A4A72] dark:text-[#E1B8D4] focus:outline-none focus:border-[#8A4A72] uppercase"
            />
          </div>

          {/* Quick preset glyph words */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-[#8A4A72] dark:text-[#E1B8D4] font-medium">Quick Art:</span>
            {GPS_ART_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setGpsArtText(preset)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono border transition-all cursor-pointer ${
                  gpsArtText === preset
                    ? 'bg-[#8A4A72] text-white border-[#8A4A72] font-bold'
                    : 'bg-white/80 dark:bg-[#19201D] text-[#8A4A72] dark:text-[#E1B8D4] border-[#8A4A72]/30 hover:bg-[#8A4A72]/20'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Explicit Notice */}
          <div className="p-2.5 rounded-xl bg-[#8A4A72]/15 dark:bg-[#8A4A72]/30 border border-[#8A4A72]/30 text-[11px] text-stone-700 dark:text-stone-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#C86432] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-[#C86432]">Notice:</strong> GPS Art fits strokes to real street grids, strictly avoiding highways and keeping distance within ±1% tolerance.
            </p>
          </div>
        </div>
      ) : null}

      {/* 5. Target Distance: INPUT BOX (No scroll bar / slider) + Stepper & Presets */}
      <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-sm">
        <div className="flex items-center justify-between">
          <label htmlFor="target-distance-input" className="text-xs font-semibold text-stone-700 dark:text-stone-300">
            Target Distance
          </label>
          <div className="flex items-center rounded-lg bg-[#F4EFE6] dark:bg-[#121614] p-0.5 border border-[#E5DFD3] dark:border-[#2E3C34]">
            <button
              type="button"
              id="unit-km-btn"
              onClick={() => onUnitChange('km')}
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                unit === 'km' ? 'bg-[#2D4F3E] text-white shadow-sm' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              KM
            </button>
            <button
              type="button"
              id="unit-mi-btn"
              onClick={() => onUnitChange('mi')}
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                unit === 'mi' ? 'bg-[#2D4F3E] text-white shadow-sm' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              MILES
            </button>
          </div>
        </div>

        {/* Dedicated Numeric Input Box with Steppers */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjustDistance(-0.5)}
            aria-label="Decrease distance"
            className="w-10 h-10 rounded-xl bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300 hover:bg-[#EAE4D7] dark:hover:bg-[#324038] flex items-center justify-center transition-colors cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>

          <div className="relative flex-1">
            <input
              type="number"
              id="target-distance-input"
              min="0.5"
              max="150"
              step="0.1"
              value={distanceValue}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) setDistanceValue(val);
                else setDistanceValue(0);
              }}
              className="w-full text-center py-2 px-3 text-lg font-mono font-bold text-[#2D4F3E] dark:text-[#7EB89B] bg-[#F8F5EE] dark:bg-[#121614] border border-[#E5DFD3] dark:border-[#2E3C34] rounded-xl focus:outline-none focus:border-[#2D4F3E] dark:focus:border-[#5C8E76]"
            />
            <span className="absolute right-3 top-2.5 text-xs font-mono font-semibold text-stone-400">
              {unit}
            </span>
          </div>

          <button
            type="button"
            onClick={() => adjustDistance(0.5)}
            aria-label="Increase distance"
            className="w-10 h-10 rounded-xl bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300 hover:bg-[#EAE4D7] dark:hover:bg-[#324038] flex items-center justify-center transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Distance Preset Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] text-stone-500 font-medium">Presets:</span>
          {distancePresets.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setDistanceValue(val)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-colors border cursor-pointer ${
                distanceValue === val
                  ? 'bg-[#2D4F3E] text-white border-[#2D4F3E] font-semibold'
                  : 'bg-[#F4EFE6] dark:bg-[#25302A] text-stone-700 dark:text-stone-300 border-[#E5DFD3] dark:border-[#2E3C34] hover:bg-[#EAE4D7] dark:hover:bg-[#324038]'
              }`}
            >
              {val} {unit}
            </button>
          ))}
        </div>
      </div>

      {/* 6. Optional Route Name & Elevation Tendency */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">Route Name (Optional)</label>
          <input
            type="text"
            id="route-name-input"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            placeholder="e.g. Morning Trail Loop"
            className="w-full px-2.5 py-2 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs text-stone-800 dark:text-stone-200 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-[#2D4F3E]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">Terrain Profile</label>
          <select
            id="terrain-profile-select"
            value={elevationPreference}
            onChange={(e) => setElevationPreference(e.target.value as ElevationPreference)}
            className="w-full px-2.5 py-2 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs text-stone-800 dark:text-stone-200 focus:outline-none focus:border-[#2D4F3E]"
          >
            <option value="flat">Flat (~5-15m)</option>
            <option value="moderate">Moderate Rolling</option>
            <option value="hilly">Hilly Climbs</option>
          </select>
        </div>
      </div>

      {/* 7. Privacy & PostGIS Masking Toggle */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-sm">
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${privacyMaskingEnabled ? 'text-[#2D4F3E] dark:text-[#7EB89B]' : 'text-stone-400'}`} />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">500m Privacy Masking</span>
            <span className="text-[10px] text-stone-500 dark:text-stone-400">
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
          <div className="w-9 h-5 bg-stone-300 dark:bg-stone-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#2D4F3E] dark:peer-checked:bg-[#436E58]"></div>
        </label>
      </div>

      {/* 8. Generate Route CTA Button */}
      <button
        type="submit"
        id="generate-route-submit-btn"
        disabled={isLoading}
        className="w-full py-3.5 px-4 rounded-xl bg-[#2D4F3E] hover:bg-[#233F31] active:bg-[#1C3328] text-white font-bold text-sm tracking-wide shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Calculating Real Road Snapping...</span>
          </>
        ) : (
          <>
            <Zap className="w-4 h-4 fill-white" />
            <span>
              {routeType === 'gps_art' ? `Generate "${gpsArtText || 'RUN'}" GPS Art` : 'Generate Optimal Route'}
            </span>
          </>
        )}
      </button>
    </form>
  );
};
