import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ActivityType, ElevationPoint, GeneratedRoute, LatLng, RouteType } from '../types/route';
import { Layers, Maximize2, Minimize2, Navigation, ShieldCheck, ZoomIn, ZoomOut, MapPin } from 'lucide-react';

interface MapProps {
  route: GeneratedRoute | null;
  hoveredElevationPoint: ElevationPoint | null;
  onMapClick?: (latLng: LatLng) => void;
  selectedLocation: LatLng;
  showPrivacyBuffer?: boolean;
  isDarkMode?: boolean;
}

type TileLayerKey = 'outdoors' | 'light' | 'dark' | 'satellite' | 'topo';

// Robust, fast, and 403-free tile layers with earthy natural cartography
const TILE_LAYERS: Record<TileLayerKey, { name: string; url: string; attribution: string; subdomains?: string[] }> = {
  outdoors: {
    name: 'Natural Outdoors',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  light: {
    name: 'Clean Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  dark: {
    name: 'Tactical Slate',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  satellite: {
    name: 'Satellite View',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  },
  topo: {
    name: 'Topographic Contours',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, DeLorme, NAVTEQ',
  },
};

export const Map: React.FC<MapProps> = ({
  route,
  hoveredElevationPoint,
  onMapClick,
  selectedLocation,
  showPrivacyBuffer = true,
  isDarkMode = false,
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
  const directionalMarkersRef = useRef<L.Marker[]>([]);

  const [activeTile, setActiveTile] = useState<TileLayerKey>(isDarkMode ? 'dark' : 'outdoors');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);

  // Sync default layer with theme changes if user hasn't manually swapped to satellite/topo
  useEffect(() => {
    if (activeTile === 'dark' || activeTile === 'outdoors' || activeTile === 'light') {
      setActiveTile(isDarkMode ? 'dark' : 'outdoors');
    }
  }, [isDarkMode]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [selectedLocation.lat, selectedLocation.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    const initialLayerConfig = TILE_LAYERS[activeTile];
    const initialLayer = L.tileLayer(initialLayerConfig.url, {
      attribution: initialLayerConfig.attribution,
      subdomains: initialLayerConfig.subdomains || ['a', 'b', 'c', 'd'],
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
    const layerConfig = TILE_LAYERS[activeTile];
    const newLayer = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      subdomains: layerConfig.subdomains || ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newLayer;
  }, [activeTile]);

  // Update Selected Location Marker (Always active & draggable for seamless re-routing)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (clickMarkerRef.current) {
      map.removeLayer(clickMarkerRef.current);
      clickMarkerRef.current = null;
    }

    const pinHtml = `
      <div class="relative flex items-center justify-center cursor-pointer group">
        <div class="absolute w-10 h-10 rounded-full bg-[#2D4F3E]/30 dark:bg-[#5C8E76]/35 animate-ping"></div>
        <div class="w-8 h-8 rounded-full bg-[#2D4F3E] dark:bg-[#436E58] border-2 border-white dark:border-[#121614] flex items-center justify-center shadow-xl text-white font-bold text-xs transform transition-transform group-hover:scale-115">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
      </div>
    `;
    const icon = L.divIcon({
      className: 'custom-start-icon',
      html: pinHtml,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const marker = L.marker([selectedLocation.lat, selectedLocation.lng], {
      icon,
      draggable: true,
      zIndexOffset: 1000,
    }).addTo(map);

    marker.bindPopup(
      `<div class="p-1.5 font-sans">
        <b class="text-xs font-semibold text-[#2D4F3E] dark:text-[#7EB89B]">Starting Point / Trailhead</b>
        <p class="text-[11px] text-stone-600 dark:text-stone-300 mt-0.5">Drag to reposition or click anywhere on the map</p>
        <div class="mt-1 text-[10px] font-mono text-stone-500">${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}</div>
      </div>`
    );

    marker.on('dragend', (e) => {
      const newPos = (e.target as L.Marker).getLatLng();
      if (onMapClick) {
        onMapClick({ lat: newPos.lat, lng: newPos.lng });
      }
    });

    clickMarkerRef.current = marker;

    // Pan map to new selected location smoothly
    map.flyTo([selectedLocation.lat, selectedLocation.lng], Math.max(map.getZoom(), 14), {
      duration: 0.8,
    });
  }, [selectedLocation, onMapClick]);

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
    directionalMarkersRef.current.forEach((m) => map.removeLayer(m));
    directionalMarkersRef.current = [];

    if (!route || route.coordinates.length === 0) return;

    // Earthy outdoor palette
    let strokeColor = '#2D4F3E'; // Deep Forest Green for run / standard
    let glowColor = 'rgba(45, 79, 62, 0.25)';

    if (route.routeType === 'gps_art') {
      strokeColor = '#8A4A72'; // Organic Heather / Mulberry for GPS Art
      glowColor = 'rgba(138, 74, 114, 0.28)';
    } else if (route.activity === 'bike') {
      strokeColor = '#C86432'; // Warm Terracotta for bike
      glowColor = 'rgba(200, 100, 50, 0.28)';
    } else if (route.activity === 'hike') {
      strokeColor = '#8C6838'; // Warm Amber / Ochre for hike
      glowColor = 'rgba(140, 104, 56, 0.28)';
    }

    // Outer subtle organic glow polyline
    polylineGlowRef.current = L.polyline(route.coordinates, {
      color: glowColor,
      weight: 10,
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

    // Directional chevron arrows along the route showing travel direction
    if (route.coordinates.length >= 6) {
      const numArrows = Math.min(12, Math.max(4, Math.floor(route.coordinates.length / 15)));
      const step = Math.floor(route.coordinates.length / (numArrows + 1));

      for (let i = step; i < route.coordinates.length - 2; i += step) {
        const p1 = route.coordinates[i];
        const p2 = route.coordinates[i + 1];
        const lat1 = (p1[0] * Math.PI) / 180;
        const lat2 = (p2[0] * Math.PI) / 180;
        const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

        const arrowIcon = L.divIcon({
          className: 'route-directional-arrow',
          html: `
            <div style="transform: rotate(${bearing}deg);" class="flex items-center justify-center pointer-events-none">
              <div style="background-color: ${strokeColor};" class="w-4 h-4 rounded-full border border-white dark:border-stone-900 shadow-md flex items-center justify-center text-white">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
          `,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });

        const arrowMarker = L.marker(p1, { icon: arrowIcon, interactive: false }).addTo(map);
        directionalMarkersRef.current.push(arrowMarker);
      }
    }

    // Start Marker on the route line
    const startCoord = route.coordinates[0];
    const startIcon = L.divIcon({
      className: 'route-start-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-6 h-6 rounded-full bg-[#2D4F3E] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[10px] font-extrabold tracking-tighter">
            GO
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    startMarkerRef.current = L.marker(startCoord, { icon: startIcon })
      .addTo(map)
      .bindPopup(
        `<div class="p-1 font-sans">
          <b class="text-[#2D4F3E] dark:text-[#7EB89B] text-xs">Route Start Point</b>
          <p class="text-[11px] text-stone-600 dark:text-stone-300 mt-1">${route.startingAddress}</p>
        </div>`
      );

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
            <div class="w-6 h-6 rounded-full bg-[#C86432] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[11px] font-bold">
              🏁
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      endMarkerRef.current = L.marker(endCoord, { icon: endIcon })
        .addTo(map)
        .bindPopup(
          `<div class="p-1 font-sans">
            <b class="text-[#C86432] text-xs">Finish Line</b>
            <p class="text-[11px] text-stone-600 dark:text-stone-300 mt-1">Distance: ${route.stats.distanceKm} km</p>
          </div>`
        );
    }

    // Privacy Buffer Visualizer (500m circle around sensitive origins)
    if (showPrivacyBuffer && route.privacy.applied) {
      privacyCircleStartRef.current = L.circle(
        [route.privacy.originalStart.lat, route.privacy.originalStart.lng],
        {
          radius: 500,
          color: '#5E8271',
          dashArray: '4, 8',
          fillColor: '#5E8271',
          fillOpacity: 0.12,
          weight: 1.5,
        }
      )
        .addTo(map)
        .bindPopup(`<div class="text-xs text-stone-700 dark:text-stone-300 font-medium">500m Privacy Protected Zone (Start)</div>`);

      if (route.privacy.originalEnd) {
        privacyCircleEndRef.current = L.circle(
          [route.privacy.originalEnd.lat, route.privacy.originalEnd.lng],
          {
            radius: 500,
            color: '#5E8271',
            dashArray: '4, 8',
            fillColor: '#5E8271',
            fillOpacity: 0.12,
            weight: 1.5,
          }
        )
          .addTo(map)
          .bindPopup(`<div class="text-xs text-stone-700 dark:text-stone-300 font-medium">500m Privacy Protected Zone (Finish)</div>`);
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
      hoverMarkerRef.current = L.circleMarker(
        [hoveredElevationPoint.lat, hoveredElevationPoint.lng],
        {
          radius: 7,
          fillColor: '#C86432',
          fillOpacity: 1,
          color: '#ffffff',
          weight: 2.5,
        }
      ).addTo(map);
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
      className="relative w-full h-full min-h-[440px] rounded-2xl overflow-hidden border border-[#E5DFD3] dark:border-[#28342E] bg-[#F4EFE6] dark:bg-[#121614] shadow-md transition-colors"
    >
      {/* The Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full min-h-[440px] z-0 cursor-crosshair" />

      {/* Floating Tactical Overlay Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
        {/* Layer Selector */}
        <div className="relative">
          <button
            id="map-layer-toggle-btn"
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            aria-label="Toggle map layer menu"
            className="p-2.5 rounded-xl bg-white/95 dark:bg-[#19201D]/95 border border-[#E5DFD3] dark:border-[#2E3C34] text-[#2D4F3E] dark:text-[#E8EAE6] hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] backdrop-blur-md shadow-md transition-all cursor-pointer"
          >
            <Layers className="w-4 h-4" />
          </button>

          {showLayerMenu && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl bg-white/98 dark:bg-[#19201D]/98 border border-[#E5DFD3] dark:border-[#2E3C34] p-1.5 shadow-xl backdrop-blur-md flex flex-col gap-1 text-xs">
              {(Object.keys(TILE_LAYERS) as TileLayerKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveTile(key);
                    setShowLayerMenu(false);
                  }}
                  className={`px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between cursor-pointer ${
                    activeTile === key
                      ? 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/30 text-[#2D4F3E] dark:text-[#8EB39F] font-semibold border border-[#2D4F3E]/30 dark:border-[#5C8E76]/40'
                      : 'text-stone-700 dark:text-stone-300 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A]'
                  }`}
                >
                  <span>{TILE_LAYERS[key].name}</span>
                  {activeTile === key && <span className="w-1.5 h-1.5 rounded-full bg-[#2D4F3E] dark:bg-[#8EB39F]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex flex-col rounded-xl bg-white/95 dark:bg-[#19201D]/95 border border-[#E5DFD3] dark:border-[#2E3C34] backdrop-blur-md shadow-md overflow-hidden">
          <button
            id="map-zoom-in-btn"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            className="p-2.5 text-stone-700 dark:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] transition-colors border-b border-[#E5DFD3] dark:border-[#2E3C34] cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            id="map-zoom-out-btn"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            className="p-2.5 text-stone-700 dark:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] transition-colors cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>

        {/* Recenter */}
        <button
          id="map-recenter-btn"
          onClick={handleRecenter}
          aria-label="Recenter map"
          className="p-2.5 rounded-xl bg-white/95 dark:bg-[#19201D]/95 border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] backdrop-blur-md shadow-md transition-all cursor-pointer"
        >
          <Navigation className="w-4 h-4" />
        </button>

        {/* Fullscreen */}
        <button
          id="map-fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label="Toggle full screen"
          className="p-2.5 rounded-xl bg-white/95 dark:bg-[#19201D]/95 border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] backdrop-blur-md shadow-md transition-all cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Coordinate & Scale HUD (Bottom Left) */}
      <div className="absolute bottom-3 left-4 z-[400] pointer-events-none hidden sm:flex items-center gap-3 text-[10px] font-mono text-stone-600 dark:text-stone-400 bg-white/90 dark:bg-[#121614]/90 px-3 py-1 rounded-lg border border-[#E5DFD3] dark:border-[#2E3C34] backdrop-blur-sm shadow-sm">
        <span>LAT: {selectedLocation.lat.toFixed(4)}</span>
        <span>LNG: {selectedLocation.lng.toFixed(4)}</span>
        {route && <span>PTS: {route.coordinates.length}</span>}
      </div>
    </div>
  );
};
