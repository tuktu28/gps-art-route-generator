import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ActivityType, DistanceUnit, ElevationPoint, GeneratedRoute, LatLng, RouteType } from '../types/route';
import { calculateDistanceMeters, calculateTotalDistanceKm } from '../lib/routingEngine';
import {
  Check,
  CircleDot,
  CornerUpLeft,
  Edit3,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Navigation,
  Pencil,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  MapPin,
} from 'lucide-react';

// Helper to linearly interpolate between two hex colors
function interpolateHexColor(color1: string, color2: string, factor: number): string {
  const c1 = parseInt(color1.replace('#', ''), 16);
  const c2 = parseInt(color2.replace('#', ''), 16);
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = Math.round(r1 + factor * (r2 - r1));
  const g = Math.round(g1 + factor * (g2 - g1));
  const b = Math.round(b1 + factor * (b2 - b1));
  return `rgb(${r}, ${g}, ${b})`;
}

// 3-stop gradient from Start (Emerald #10B981) -> Mid (Amber #F59E0B) -> Finish (Coral #EF4444)
export function getRouteGradientColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    return interpolateHexColor('#10B981', '#F59E0B', clamped * 2);
  } else {
    return interpolateHexColor('#F59E0B', '#EF4444', (clamped - 0.5) * 2);
  }
}

interface MapProps {
  route: GeneratedRoute | null;
  hoveredElevationPoint: ElevationPoint | null;
  onMapClick?: (latLng: LatLng) => void;
  selectedLocation: LatLng;
  isDarkMode?: boolean;
  unit?: DistanceUnit;
  // Manual Draw / Edit Mode Props
  isManualMode?: boolean;
  isEditMode?: boolean;
  manualWaypoints?: [number, number][];
  snappedCoordinates?: [number, number][];
  snapToRoads?: boolean;
  onToggleSnapToRoads?: () => void;
  isSnapping?: boolean;
  onManualWaypointsChange?: (waypoints: [number, number][]) => void;
  onUndoPoint?: () => void;
  onCloseLoop?: () => void;
  onClearPoints?: () => void;
  onSaveManualRoute?: () => void;
  onSaveEditedRoute?: () => void;
  onCancelEdit?: () => void;
  onReverseRoute?: () => void;
}

type TileLayerKey = 'osm' | 'outdoors' | 'light' | 'dark' | 'satellite' | 'topo';

// Robust, high-speed tile layers with validated URLs and OpenStreetMap fallback
const TILE_LAYERS: Record<
  TileLayerKey,
  { name: string; url: string; fallbackUrl?: string; attribution: string; subdomains?: string[] }
> = {
  osm: {
    name: 'OpenStreetMap (Standard)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  outdoors: {
    name: 'Natural Outdoors (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  light: {
    name: 'Clean Light (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  dark: {
    name: 'Tactical Slate (Dark)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    subdomains: ['a', 'b', 'c', 'd'],
  },
  satellite: {
    name: 'Satellite Imagery',
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
  isDarkMode = false,
  unit = 'mi',
  isManualMode = false,
  isEditMode = false,
  manualWaypoints = [],
  snappedCoordinates = [],
  snapToRoads = true,
  onToggleSnapToRoads,
  isSnapping = false,
  onManualWaypointsChange,
  onUndoPoint,
  onCloseLoop,
  onClearPoints,
  onSaveManualRoute,
  onSaveEditedRoute,
  onCancelEdit,
  onReverseRoute,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const polylineContainerRef = useRef<L.LayerGroup | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const endMarkerRef = useRef<L.Marker | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);
  const directionalMarkersRef = useRef<L.Marker[]>([]);
  const waypointMarkersRef = useRef<L.Marker[]>([]);

  const [activeTile, setActiveTile] = useState<TileLayerKey>(isDarkMode ? 'dark' : 'osm');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);

  // Sync default layer with theme changes
  useEffect(() => {
    if (activeTile === 'dark' || activeTile === 'osm' || activeTile === 'outdoors' || activeTile === 'light') {
      setActiveTile(isDarkMode ? 'dark' : 'osm');
    }
  }, [isDarkMode]);

  // Expose global waypoint delete handler for popup buttons
  useEffect(() => {
    (window as any).__deleteMapWaypoint = (index: number) => {
      if (onManualWaypointsChange && manualWaypoints.length > index) {
        const updated = manualWaypoints.filter((_, i) => i !== index);
        onManualWaypointsChange(updated);
      }
    };
    return () => {
      delete (window as any).__deleteMapWaypoint;
    };
  }, [manualWaypoints, onManualWaypointsChange]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [selectedLocation.lat, selectedLocation.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    mapInstanceRef.current = map;

    // ResizeObserver ensures the map tiles constantly fill container without blank gaps
    const container = mapContainerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(container);

    const timer1 = setTimeout(() => map.invalidateSize(), 150);
    const timer2 = setTimeout(() => map.invalidateSize(), 600);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Map Click Handler based on Active Mode
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleLeafletClick = (e: L.LeafletMouseEvent) => {
      if (isManualMode || isEditMode) {
        if (onManualWaypointsChange) {
          const newPt: [number, number] = [e.latlng.lat, e.latlng.lng];
          onManualWaypointsChange([...manualWaypoints, newPt]);
        }
      } else {
        if (onMapClick) {
          onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      }
    };

    map.off('click');
    map.on('click', handleLeafletClick);

    return () => {
      map.off('click', handleLeafletClick);
    };
  }, [isManualMode, isEditMode, manualWaypoints, onManualWaypointsChange, onMapClick]);

  // Update Tile Layer with Fallback & CORS
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const layerConfig = TILE_LAYERS[activeTile] || TILE_LAYERS.osm;
    const newLayer = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      subdomains: layerConfig.subdomains || ['a', 'b', 'c', 'd'],
      maxZoom: 19,
      crossOrigin: true,
    });

    newLayer.on('tileerror', () => {
      if (layerConfig.fallbackUrl) {
        newLayer.setUrl(layerConfig.fallbackUrl);
      }
    });

    newLayer.addTo(map);
    tileLayerRef.current = newLayer;
    map.invalidateSize();
  }, [activeTile]);

  // Ensure map layout resizes when entering or exiting manual/edit modes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isManualMode, isEditMode]);

  // Update Selected Location Marker (only when not in manual/edit mode)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (clickMarkerRef.current) {
      map.removeLayer(clickMarkerRef.current);
      clickMarkerRef.current = null;
    }

    if (isManualMode || isEditMode) {
      return; // Waypoint markers will handle start/end display in manual/edit modes
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
  }, [selectedLocation, onMapClick, isManualMode, isEditMode]);

  // Render Route Polyline & Markers (Regular Mode) vs Draggable Waypoint Handles (Manual/Edit Mode)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear previous layers
    if (polylineContainerRef.current) {
      map.removeLayer(polylineContainerRef.current);
      polylineContainerRef.current = null;
    }
    if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }
    if (endMarkerRef.current) {
      map.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }
    directionalMarkersRef.current.forEach((m) => map.removeLayer(m));
    directionalMarkersRef.current = [];
    waypointMarkersRef.current.forEach((m) => map.removeLayer(m));
    waypointMarkersRef.current = [];

    // ==========================================
    // CASE A: MANUAL DRAW OR MANUAL EDIT MODE
    // ==========================================
    if (isManualMode || isEditMode) {
      if (!manualWaypoints || manualWaypoints.length === 0) return;

      const layerGroup = L.layerGroup().addTo(map);
      polylineContainerRef.current = layerGroup;

      // Use snapped road-following coordinates if available, otherwise raw waypoints
      const roadCoords =
        snappedCoordinates && snappedCoordinates.length > 1
          ? snappedCoordinates
          : manualWaypoints;

      // 1. Base Casing Polyline along snapped roads
      if (roadCoords.length >= 2) {
        L.polyline(roadCoords, {
          color: isDarkMode ? '#0F1512' : '#FFFFFF',
          weight: 8,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layerGroup);

        // 2. Gradient Polyline along snapped roads
        const numPoints = roadCoords.length;
        for (let i = 0; i < numPoints - 1; i++) {
          const p1 = roadCoords[i];
          const p2 = roadCoords[i + 1];
          const progressT = (i + 0.5) / (numPoints - 1);
          const segColor = getRouteGradientColor(progressT);

          L.polyline([p1, p2], {
            color: segColor,
            weight: 5,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(layerGroup);
        }
      }

      // 3. Draggable Waypoint Markers at control waypoints
      manualWaypoints.forEach((pt, index) => {
        const isStart = index === 0;
        const isEnd = index === manualWaypoints.length - 1 && manualWaypoints.length > 1;
        const isClosedLoop =
          manualWaypoints.length > 2 &&
          calculateDistanceMeters(manualWaypoints[0], manualWaypoints[manualWaypoints.length - 1]) < 35;

        let iconHtml = '';
        let iconSize: [number, number] = [28, 28];
        let iconAnchor: [number, number] = [14, 14];

        if (isStart) {
          iconHtml = `
            <div class="relative flex items-center justify-center cursor-move">
              <div class="w-7 h-7 rounded-full bg-[#10B981] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[10px] font-extrabold tracking-tighter ring-2 ring-[#10B981]/50">
                GO
              </div>
            </div>
          `;
          iconSize = [32, 32];
          iconAnchor = [16, 16];
        } else if (isEnd && isClosedLoop) {
          iconHtml = `
            <div class="relative flex items-center justify-center cursor-move">
              <div class="w-7 h-7 rounded-full bg-[#2D4F3E] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[11px] font-bold ring-2 ring-[#2D4F3E]/50">
                🔄
              </div>
            </div>
          `;
          iconSize = [32, 32];
          iconAnchor = [16, 16];
        } else if (isEnd) {
          iconHtml = `
            <div class="relative flex items-center justify-center cursor-move">
              <div class="w-7 h-7 rounded-full bg-[#EF4444] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[11px] font-bold ring-2 ring-[#EF4444]/50">
                🏁
              </div>
            </div>
          `;
          iconSize = [32, 32];
          iconAnchor = [16, 16];
        } else {
          iconHtml = `
            <div class="relative flex items-center justify-center cursor-move hover:scale-125 transition-transform">
              <div class="w-5 h-5 rounded-full bg-white dark:bg-[#1E2723] border-2 border-[#D98A3C] flex items-center justify-center text-[#D98A3C] shadow-md text-[9px] font-mono font-bold">
                ${index + 1}
              </div>
            </div>
          `;
          iconSize = [24, 24];
          iconAnchor = [12, 12];
        }

        const markerIcon = L.divIcon({
          className: 'custom-manual-waypoint',
          html: iconHtml,
          iconSize,
          iconAnchor,
        });

        const waypointMarker = L.marker(pt, {
          icon: markerIcon,
          draggable: true,
          zIndexOffset: isStart || isEnd ? 1200 : 800 + index,
        }).addTo(map);

        // Waypoint Popup with Quick Controls
        waypointMarker.bindPopup(
          `<div class="p-1 font-sans text-stone-800 dark:text-stone-100">
            <div class="flex items-center gap-1.5 font-bold text-xs text-[#2D4F3E]">
              <span>Waypoint #${index + 1}</span>
              ${isStart ? '<span class="px-1.5 py-0.2 bg-[#10B981]/20 text-[#10B981] text-[9px] rounded-sm">START</span>' : ''}
              ${isEnd ? '<span class="px-1.5 py-0.2 bg-[#EF4444]/20 text-[#EF4444] text-[9px] rounded-sm">FINISH</span>' : ''}
            </div>
            <p class="text-[10px] text-stone-500 mt-0.5">Drag marker to reshape path</p>
            <div class="mt-1.5 pt-1.5 border-t border-stone-200 flex items-center justify-between gap-2">
              <span class="text-[9px] font-mono text-stone-400">${pt[0].toFixed(4)}, ${pt[1].toFixed(4)}</span>
              ${manualWaypoints.length > 2 ? `<button onclick="window.__deleteMapWaypoint(${index})" class="px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 text-[10px] font-bold cursor-pointer">Delete</button>` : ''}
            </div>
          </div>`
        );

        // Draggable event
        waypointMarker.on('dragend', (e) => {
          const newPos = (e.target as L.Marker).getLatLng();
          if (onManualWaypointsChange) {
            const updated = [...manualWaypoints];
            updated[index] = [newPos.lat, newPos.lng];
            onManualWaypointsChange(updated);
          }
        });

        waypointMarkersRef.current.push(waypointMarker);
      });

      return;
    }

    // ==========================================
    // CASE B: STANDARD GENERATED ROUTE VIEW
    // ==========================================
    if (!route || route.coordinates.length === 0) return;

    const coords = route.coordinates;
    const layerGroup = L.layerGroup().addTo(map);
    polylineContainerRef.current = layerGroup;

    // 1. Base Casing / Glow polyline
    L.polyline(coords, {
      color: isDarkMode ? '#0F1512' : '#FFFFFF',
      weight: 8,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layerGroup);

    // 2. Render Gradient Polyline Segments
    const numPoints = coords.length;
    for (let i = 0; i < numPoints - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const progressT = (i + 0.5) / (numPoints - 1);
      const segColor = getRouteGradientColor(progressT);

      L.polyline([p1, p2], {
        color: segColor,
        weight: 5,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);
    }

    // 3. Directional Chevron Arrows
    const QUARTER_MILE_METERS = 402.336;
    const cumulativeDistances: number[] = [0];
    let totalRouteMeters = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const segDist = calculateDistanceMeters(coords[i], coords[i + 1]);
      totalRouteMeters += segDist;
      cumulativeDistances.push(totalRouteMeters);
    }

    const targetDistances: number[] = [];
    if (totalRouteMeters >= QUARTER_MILE_METERS) {
      let targetM = QUARTER_MILE_METERS;
      while (targetM <= totalRouteMeters - 50) {
        targetDistances.push(targetM);
        targetM += QUARTER_MILE_METERS;
      }
    } else if (totalRouteMeters >= 80) {
      targetDistances.push(totalRouteMeters * 0.5);
    }

    targetDistances.forEach((targetM) => {
      let segIndex = 0;
      while (segIndex < cumulativeDistances.length - 1 && cumulativeDistances[segIndex + 1] < targetM) {
        segIndex++;
      }

      const p1 = coords[segIndex];
      const p2 = coords[Math.min(segIndex + 1, coords.length - 1)];
      const segStartDist = cumulativeDistances[segIndex];
      const segEndDist = cumulativeDistances[Math.min(segIndex + 1, cumulativeDistances.length - 1)];
      const segLength = segEndDist - segStartDist;

      const fraction = segLength > 0 ? Math.max(0.05, Math.min(0.95, (targetM - segStartDist) / segLength)) : 0.5;
      const interpLat = p1[0] + fraction * (p2[0] - p1[0]);
      const interpLng = p1[1] + fraction * (p2[1] - p1[1]);

      const lat1 = (p1[0] * Math.PI) / 180;
      const lat2 = (p2[0] * Math.PI) / 180;
      const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

      const progressRatio = totalRouteMeters > 0 ? targetM / totalRouteMeters : 0.5;
      const arrowColor = getRouteGradientColor(progressRatio);

      const arrowIcon = L.divIcon({
        className: 'route-directional-arrow',
        html: `
          <div style="transform: rotate(${bearing}deg);" class="flex items-center justify-center pointer-events-none">
            <div style="background-color: ${arrowColor};" class="w-4 h-4 rounded-full border border-white dark:border-stone-900 shadow-md flex items-center justify-center text-white">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 15 12 9 18 15"></polyline>
              </svg>
            </div>
          </div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const arrowMarker = L.marker([interpLat, interpLng], { icon: arrowIcon, interactive: false }).addTo(map);
      directionalMarkersRef.current.push(arrowMarker);
    });

    // Start Marker
    const startCoord = route.coordinates[0];
    const startIcon = L.divIcon({
      className: 'route-start-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-6 h-6 rounded-full bg-[#10B981] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[10px] font-extrabold tracking-tighter">
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
          <b class="text-[#10B981] text-xs">Route Start Point</b>
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
            <div class="w-6 h-6 rounded-full bg-[#EF4444] border-2 border-white dark:border-[#121614] flex items-center justify-center text-white shadow-xl text-[11px] font-bold">
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
            <b class="text-[#EF4444] text-xs">Finish Line</b>
            <p class="text-[11px] text-stone-600 dark:text-stone-300 mt-1">Distance: ${route.stats.distanceKm} km</p>
          </div>`
        );
    }

    // Smoothly fit map bounds
    const bounds = L.latLngBounds(route.coordinates);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [route, isManualMode, isEditMode, manualWaypoints, snappedCoordinates, isDarkMode]);

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
    if ((isManualMode || isEditMode) && manualWaypoints.length > 0) {
      const bounds = L.latLngBounds(manualWaypoints);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    } else if (route && route.coordinates.length > 0) {
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

  // Manual distance calculation (prioritizing road-snapped geometry)
  const activeRoadCoords =
    snappedCoordinates && snappedCoordinates.length > 1
      ? snappedCoordinates
      : manualWaypoints;
  const manualDistKm = activeRoadCoords.length >= 2 ? calculateTotalDistanceKm(activeRoadCoords) : 0;
  const manualDistDisplay =
    unit === 'mi'
      ? `${(manualDistKm * 0.621371).toFixed(2)} mi`
      : `${manualDistKm.toFixed(2)} km`;

  return (
    <div
      id="interactive-map-container"
      className="relative w-full h-full min-h-[440px] rounded-2xl overflow-hidden border border-[#E5DFD3] dark:border-[#28342E] bg-[#F4EFE6] dark:bg-[#121614] shadow-md transition-colors"
    >
      {/* The Leaflet Container */}
      <div
        ref={mapContainerRef}
        className={`w-full h-full min-h-[440px] z-0 ${
          isManualMode || isEditMode ? 'cursor-crosshair' : 'cursor-default'
        }`}
      />

      {/* Floating Tactical Overlay Controls (Layers, Zoom, Recenter, Fullscreen) */}
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

      {/* ======================================================== */}
      {/* FLOATING ACTION TOOLBAR FOR MANUAL DRAW OR EDIT MODES   */}
      {/* ======================================================== */}
      {isManualMode && (
        <div className="absolute top-3.5 left-3.5 right-14 sm:right-auto z-20 flex flex-col gap-2 pointer-events-auto">
          <div className="p-2.5 sm:p-3 rounded-2xl bg-white/95 dark:bg-[#161D1A]/95 border border-[#2D4F3E]/40 dark:border-[#5C8E76]/40 shadow-xl backdrop-blur-md flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-2 pr-2 border-r border-[#E5DFD3] dark:border-[#2E3C34]">
              <div className="w-6 h-6 rounded-lg bg-[#2D4F3E] text-white flex items-center justify-center shadow-xs">
                <Pencil className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[#2D4F3E] dark:text-[#7EB89B] text-[11px] uppercase tracking-wider">
                    Manual Draw Mode
                  </span>
                  {isSnapping && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#2D4F3E]/15 text-[#2D4F3E] dark:text-[#7EB89B] text-[9px] font-semibold animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      Snapping...
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-stone-500 font-mono">
                  {manualWaypoints.length} pts • {manualDistDisplay}
                </span>
              </div>
            </div>

            {/* Road Snapping Toggle */}
            {onToggleSnapToRoads && (
              <button
                type="button"
                onClick={onToggleSnapToRoads}
                title={snapToRoads ? "Road Snapping: ON (Click to draw freehand lines)" : "Road Snapping: OFF (Click to snap to roads & trails)"}
                className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 font-semibold text-[11px] cursor-pointer transition-all ${
                  snapToRoads
                    ? 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/30 text-[#2D4F3E] dark:text-[#7EB89B] border-[#2D4F3E]/40 dark:border-[#5C8E76]/50 shadow-xs'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border-stone-300 dark:border-stone-700'
                }`}
              >
                <RouteIcon className="w-3.5 h-3.5" />
                <span>Snap to Roads: {snapToRoads ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {/* Quick Draw Controls */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={onUndoPoint}
                disabled={manualWaypoints.length === 0}
                title="Undo last placed point"
                className="px-2.5 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-[#EAE4D7] text-stone-700 dark:text-stone-200 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5 text-[#C86432]" />
                <span className="hidden sm:inline">Undo</span>
              </button>

              <button
                type="button"
                onClick={onCloseLoop}
                disabled={manualWaypoints.length < 3}
                title="Snap path back to starting trailhead to close the loop"
                className="px-2.5 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-[#EAE4D7] text-stone-700 dark:text-stone-200 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <CircleDot className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
                <span>Close Loop</span>
              </button>

              <button
                type="button"
                onClick={onClearPoints}
                disabled={manualWaypoints.length === 0}
                title="Clear all manual waypoints"
                className="px-2 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/30 text-stone-600 dark:text-stone-400 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {onSaveManualRoute && (
                <button
                  type="button"
                  onClick={onSaveManualRoute}
                  disabled={manualWaypoints.length < 2}
                  className="px-3 py-1.5 rounded-lg bg-[#2D4F3E] hover:bg-[#233F31] text-white font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Finish Route</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isEditMode && (
        <div className="absolute top-3.5 left-3.5 right-14 sm:right-auto z-20 flex flex-col gap-2 pointer-events-auto">
          <div className="p-2.5 sm:p-3 rounded-2xl bg-white/95 dark:bg-[#161D1A]/95 border border-[#D98A3C]/50 dark:border-[#D98A3C]/50 shadow-xl backdrop-blur-md flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-2 pr-2 border-r border-[#E5DFD3] dark:border-[#2E3C34]">
              <div className="w-6 h-6 rounded-lg bg-[#D98A3C] text-white flex items-center justify-center shadow-xs">
                <Edit3 className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[#D98A3C] text-[11px] uppercase tracking-wider">
                    Editing Route Pins
                  </span>
                  {isSnapping && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#D98A3C]/15 text-[#D98A3C] text-[9px] font-semibold animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      Snapping...
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-stone-500 font-mono">
                  {manualWaypoints.length} nodes • {manualDistDisplay}
                </span>
              </div>
            </div>

            {/* Road Snapping Toggle */}
            {onToggleSnapToRoads && (
              <button
                type="button"
                onClick={onToggleSnapToRoads}
                title={snapToRoads ? "Road Snapping: ON" : "Road Snapping: OFF"}
                className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 font-semibold text-[11px] cursor-pointer transition-all ${
                  snapToRoads
                    ? 'bg-[#D98A3C]/15 text-[#D98A3C] border-[#D98A3C]/50 shadow-xs'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border-stone-300 dark:border-stone-700'
                }`}
              >
                <RouteIcon className="w-3.5 h-3.5" />
                <span>Snap to Roads: {snapToRoads ? 'ON' : 'OFF'}</span>
              </button>
            )}

            {/* Quick Edit Controls */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {onReverseRoute && (
                <button
                  type="button"
                  onClick={onReverseRoute}
                  title="Reverse route direction (swap start & finish)"
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-[#EAE4D7] text-stone-700 dark:text-stone-200 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#8C6838] dark:text-[#DFBD84]" />
                  <span className="hidden sm:inline">Reverse</span>
                </button>
              )}

              <button
                type="button"
                onClick={onUndoPoint}
                disabled={manualWaypoints.length <= 2}
                title="Undo last waypoint"
                className="px-2.5 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-[#EAE4D7] text-stone-700 dark:text-stone-200 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5 text-[#C86432]" />
                <span className="hidden sm:inline">Undo</span>
              </button>

              {onCancelEdit && (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  title="Discard edits"
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] hover:bg-stone-200 text-stone-600 dark:text-stone-400 border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center gap-1 font-medium cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              )}

              {onSaveEditedRoute && (
                <button
                  type="button"
                  onClick={onSaveEditedRoute}
                  className="px-3.5 py-1.5 rounded-lg bg-[#D98A3C] hover:bg-[#B87129] text-white font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Apply Changes</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Coordinate & Scale HUD (Bottom Left) */}
      <div className="absolute bottom-3 left-4 z-10 pointer-events-none hidden sm:flex items-center gap-3 text-[10px] font-mono text-stone-600 dark:text-stone-400 bg-white/90 dark:bg-[#121614]/90 px-3 py-1 rounded-lg border border-[#E5DFD3] dark:border-[#2E3C34] backdrop-blur-sm shadow-sm">
        <span>LAT: {selectedLocation.lat.toFixed(4)}</span>
        <span>LNG: {selectedLocation.lng.toFixed(4)}</span>
        {(isManualMode || isEditMode) ? (
          <span className="text-[#D98A3C] font-semibold">WAYPOINTS: {manualWaypoints.length}</span>
        ) : (
          route && <span>PTS: {route.coordinates.length}</span>
        )}
      </div>
    </div>
  );
};
