import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ActivityType, ElevationPoint, GeneratedRoute, LatLng, RouteType } from '../types/route';
import { Layers, Maximize2, Minimize2, Navigation, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-react';

interface MapProps {
  route: GeneratedRoute | null;
  hoveredElevationPoint: ElevationPoint | null;
  onMapClick?: (latLng: LatLng) => void;
  selectedLocation: LatLng;
  showPrivacyBuffer?: boolean;
}

type TileLayerKey = 'dark' | 'streets' | 'satellite' | 'topo';

const TILE_LAYERS: Record<TileLayerKey, { name: string; url: string; attribution: string }> = {
  dark: {
    name: 'Tactical Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
  },
  streets: {
    name: 'OSM Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  },
  topo: {
    name: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

export const Map: React.FC<MapProps> = ({
  route,
  hoveredElevationPoint,
  onMapClick,
  selectedLocation,
  showPrivacyBuffer = true,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const polylineGlowRef = useRef<L.Polyline | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const endMarkerRef = useRef<L.Marker | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  const privacyCircleStartRef = useRef<L.Circle | null>(null);
  const privacyCircleEndRef = useRef<L.Circle | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);

  const [activeTile, setActiveTile] = useState<TileLayerKey>('dark');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [selectedLocation.lat, selectedLocation.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    const initialLayer = L.tileLayer(TILE_LAYERS.dark.url, {
      attribution: TILE_LAYERS.dark.attribution,
      maxZoom: 19,
    }).addTo(map);

    tileLayerRef.current = initialLayer;
    mapInstanceRef.current = map;

    // Handle Map Click for Location Selection
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tile Layer
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }
    const newLayer = L.tileLayer(TILE_LAYERS[activeTile].url, {
      attribution: TILE_LAYERS[activeTile].attribution,
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newLayer;
  }, [activeTile]);

  // Update Selected Location Marker (when no route or when picking on map)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (clickMarkerRef.current) {
      map.removeLayer(clickMarkerRef.current);
      clickMarkerRef.current = null;
    }

    if (!route) {
      const pinHtml = `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full bg-emerald-500/30 animate-ping"></div>
          <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center shadow-lg text-white font-bold text-xs">
            📍
          </div>
        </div>
      `;
      const icon = L.divIcon({
        className: 'custom-start-icon',
        html: pinHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      clickMarkerRef.current = L.marker([selectedLocation.lat, selectedLocation.lng], { icon })
        .addTo(map)
        .bindPopup(`<b class="text-xs text-slate-200">Start Location</b><br/><span class="text-[11px] text-slate-400">Lat: ${selectedLocation.lat.toFixed(4)}, Lng: ${selectedLocation.lng.toFixed(4)}</span>`);

      map.setView([selectedLocation.lat, selectedLocation.lng], map.getZoom());
    }
  }, [selectedLocation, route]);

  // Update Route Polyline and Markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear previous route layers
    if (polylineGlowRef.current) map.removeLayer(polylineGlowRef.current);
    if (polylineRef.current) map.removeLayer(polylineRef.current);
    if (startMarkerRef.current) map.removeLayer(startMarkerRef.current);
    if (endMarkerRef.current) map.removeLayer(endMarkerRef.current);
    if (privacyCircleStartRef.current) map.removeLayer(privacyCircleStartRef.current);
    if (privacyCircleEndRef.current) map.removeLayer(privacyCircleEndRef.current);

    if (!route || route.coordinates.length === 0) return;

    // Color theme based on route type & activity
    let strokeColor = '#10b981'; // Emerald for run
    let glowColor = 'rgba(16, 185, 129, 0.35)';

    if (route.routeType === 'gps_art') {
      strokeColor = '#a855f7'; // Purple for GPS Art
      glowColor = 'rgba(168, 85, 247, 0.4)';
    } else if (route.activity === 'bike') {
      strokeColor = '#06b6d4'; // Cyan for bike
      glowColor = 'rgba(6, 182, 212, 0.4)';
    } else if (route.activity === 'hike') {
      strokeColor = '#f59e0b'; // Amber for hike
      glowColor = 'rgba(245, 158, 11, 0.4)';
    }

    // Outer glow polyline
    polylineGlowRef.current = L.polyline(route.coordinates, {
      color: glowColor,
      weight: 9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    // Main sharp polyline
    polylineRef.current = L.polyline(route.coordinates, {
      color: strokeColor,
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    // Start Marker
    const startCoord = route.coordinates[0];
    const startIcon = L.divIcon({
      className: 'route-start-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-7 h-7 rounded-full bg-emerald-400/40 animate-ping"></div>
          <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-white shadow-xl text-[10px] font-extrabold tracking-tighter">
            GO
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    startMarkerRef.current = L.marker(startCoord, { icon: startIcon })
      .addTo(map)
      .bindPopup(`<div class="p-1"><b class="text-emerald-400 text-xs">Route Start Point</b><p class="text-[11px] text-slate-300 mt-1">${route.startingAddress}</p></div>`);

    // End Marker
    const endCoord = route.coordinates[route.coordinates.length - 1];
    const isClosedLoop =
      Math.abs(startCoord[0] - endCoord[0]) < 0.0005 &&
      Math.abs(startCoord[1] - endCoord[1]) < 0.0005;

    if (!isClosedLoop) {
      const endIcon = L.divIcon({
        className: 'route-end-pin',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rounded-full bg-rose-500 border-2 border-slate-900 flex items-center justify-center text-white shadow-xl text-[11px] font-bold">
              🏁
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      endMarkerRef.current = L.marker(endCoord, { icon: endIcon })
        .addTo(map)
        .bindPopup(`<div class="p-1"><b class="text-rose-400 text-xs">Finish Line</b><p class="text-[11px] text-slate-300 mt-1">Distance: ${route.stats.distanceKm} km</p></div>`);
    }

    // Privacy Buffer Visualizer (500m circle around sensitive origins)
    if (showPrivacyBuffer && route.privacy.applied) {
      privacyCircleStartRef.current = L.circle([route.privacy.originalStart.lat, route.privacy.originalStart.lng], {
        radius: 500,
        color: '#3b82f6',
        dashArray: '4, 8',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 1.5,
      }).addTo(map).bindPopup(`<div class="text-xs text-blue-300 font-semibold">500m PostGIS Privacy Zone (Start)</div>`);

      if (route.privacy.originalEnd) {
        privacyCircleEndRef.current = L.circle([route.privacy.originalEnd.lat, route.privacy.originalEnd.lng], {
          radius: 500,
          color: '#3b82f6',
          dashArray: '4, 8',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(map).bindPopup(`<div class="text-xs text-blue-300 font-semibold">500m PostGIS Privacy Zone (Finish)</div>`);
      }
    }

    // Smoothly fit map bounds
    const bounds = L.latLngBounds(route.coordinates);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [route, showPrivacyBuffer]);

  // Synchronized Elevation Hover Pin
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (hoverMarkerRef.current) {
      map.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }

    if (hoveredElevationPoint && route) {
      hoverMarkerRef.current = L.circleMarker([hoveredElevationPoint.lat, hoveredElevationPoint.lng], {
        radius: 7,
        fillColor: '#38bdf8',
        fillOpacity: 1,
        color: '#ffffff',
        weight: 2.5,
      }).addTo(map);
    }
  }, [hoveredElevationPoint, route]);

  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();
  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    if (route && route.coordinates.length > 0) {
      const bounds = L.latLngBounds(route.coordinates);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    } else {
      mapInstanceRef.current.setView([selectedLocation.lat, selectedLocation.lng], 14);
    }
  };

  const toggleFullscreen = () => {
    if (!mapContainerRef.current) return;
    if (!document.fullscreenElement) {
      mapContainerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      id="interactive-map-container"
      className="relative w-full h-full min-h-[420px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl"
    >
      {/* The Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full min-h-[420px] z-0" />

      {/* Floating Tactical Overlay Controls */}
      <div className="absolute top-4 right-4 z-[400] flex flex-col gap-2">
        {/* Layer Selector */}
        <div className="relative">
          <button
            id="map-layer-toggle-btn"
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            aria-label="Toggle map layer menu"
            className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur-md shadow-lg transition-all"
          >
            <Layers className="w-4 h-4" />
          </button>

          {showLayerMenu && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900/95 border border-slate-700 p-1.5 shadow-2xl backdrop-blur-md flex flex-col gap-1 text-xs">
              {(Object.keys(TILE_LAYERS) as TileLayerKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveTile(key);
                    setShowLayerMenu(false);
                  }}
                  className={`px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between ${
                    activeTile === key
                      ? 'bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <span>{TILE_LAYERS[key].name}</span>
                  {activeTile === key && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex flex-col rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-md shadow-lg overflow-hidden">
          <button
            id="map-zoom-in-btn"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            className="p-2.5 text-slate-200 hover:text-white hover:bg-slate-800 transition-colors border-b border-slate-800"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            id="map-zoom-out-btn"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            className="p-2.5 text-slate-200 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>

        {/* Recenter */}
        <button
          id="map-recenter-btn"
          onClick={handleRecenter}
          aria-label="Recenter map"
          className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur-md shadow-lg transition-all"
        >
          <Navigation className="w-4 h-4" />
        </button>

        {/* Fullscreen */}
        <button
          id="map-fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label="Toggle full screen"
          className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:text-white hover:bg-slate-800 backdrop-blur-md shadow-lg transition-all"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Top Left Status Badge */}
      <div className="absolute top-4 left-4 z-[400] flex flex-wrap items-center gap-2 pointer-events-none">
        {route ? (
          <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 backdrop-blur-md shadow-xl flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full animate-pulse ${
                route.routeType === 'gps_art'
                  ? 'bg-purple-400'
                  : route.activity === 'bike'
                  ? 'bg-cyan-400'
                  : 'bg-emerald-400'
              }`}
            />
            <span className="text-xs font-semibold text-slate-100">
              {route.name}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {route.stats.distanceKm} km
            </span>
          </div>
        ) : (
          <div className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 backdrop-blur-md shadow-xl flex items-center gap-2 text-xs text-slate-300">
            <span className="text-emerald-400">📍</span> Click anywhere on map to set start point
          </div>
        )}

        {route?.privacy.applied && (
          <div className="px-2.5 py-1 rounded-xl bg-blue-950/80 border border-blue-600/40 backdrop-blur-md shadow-lg flex items-center gap-1.5 text-[11px] text-blue-300">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>500m PostGIS Mask Active</span>
          </div>
        )}
      </div>

      {/* Coordinate & Scale HUD (Bottom Left) */}
      <div className="absolute bottom-3 left-4 z-[400] pointer-events-none hidden sm:flex items-center gap-3 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800/80 backdrop-blur-sm">
        <span>LAT: {selectedLocation.lat.toFixed(4)}</span>
        <span>LNG: {selectedLocation.lng.toFixed(4)}</span>
        {route && <span>PTS: {route.coordinates.length}</span>}
      </div>
    </div>
  );
};
