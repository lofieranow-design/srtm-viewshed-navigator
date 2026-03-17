import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TacticalPoint, STATION_COLORS, STATION_LABELS, ViewshedResult } from '@/types/tactical';

interface TacticalMapProps {
  points: TacticalPoint[];
  viewshedResults: ViewshedResult[];
  isPlacing: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onPointDrag: (id: string, lat: number, lng: number) => void;
  onSuggestionClick: (lat: number, lng: number, elevation: number, fromId: string, toId: string) => void;
  centerOn: [number, number] | null;
}

export default function TacticalMap({
  points,
  viewshedResults,
  isPlacing,
  onMapClick,
  onPointDrag,
  onSuggestionClick,
  centerOn,
}: TacticalMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const linesRef = useRef<L.Polyline[]>([]);
  const suggestionsRef = useRef<L.Marker[]>([]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([36.75, 3.06], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenTopoMap',
      opacity: 0.7,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Handle click
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: L.LeafletMouseEvent) => {
      if (isPlacing) onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handler);
    map.getContainer().style.cursor = isPlacing ? 'crosshair' : 'grab';
    return () => { map.off('click', handler); };
  }, [isPlacing, onMapClick]);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(points.map((p) => p.id));

    // Remove old markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add/update markers
    points.forEach((point) => {
      let marker = markersRef.current.get(point.id);
      if (!marker) {
        const symbolMap: Record<string, string> = {
          pc_principal: `<svg viewBox="0 0 32 32" width="32" height="32"><rect x="4" y="4" width="24" height="24" fill="${STATION_COLORS[point.type]}" stroke="white" stroke-width="3" rx="3"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="14" font-weight="bold">P</text></svg>`,
          pc_harpon: `<svg viewBox="0 0 32 32" width="32" height="32"><polygon points="16,2 30,26 2,26" fill="${STATION_COLORS[point.type]}" stroke="white" stroke-width="3"/><text x="16" y="23" text-anchor="middle" fill="white" font-size="12" font-weight="bold">H</text></svg>`,
          relais: `<svg viewBox="0 0 32 32" width="32" height="32"><polygon points="16,2 30,16 16,30 2,16" fill="${STATION_COLORS[point.type]}" stroke="white" stroke-width="3"/><text x="16" y="21" text-anchor="middle" fill="white" font-size="12" font-weight="bold">R</text></svg>`,
          observation: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="13" fill="${STATION_COLORS[point.type]}" stroke="white" stroke-width="3"/><circle cx="16" cy="16" r="5" fill="none" stroke="white" stroke-width="2"/></svg>`,
        };
        const icon = L.divIcon({
          className: 'custom-marker',
          html: symbolMap[point.type] || symbolMap.observation,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        marker = L.marker([point.lat, point.lng], { icon, draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const pos = marker!.getLatLng();
          onPointDrag(point.id, pos.lat, pos.lng);
        });
        markersRef.current.set(point.id, marker);
      } else {
        marker.setLatLng([point.lat, point.lng]);
      }
      const tooltipContent = `
        <table style="border-collapse:collapse;font-size:12px;min-width:180px;">
          <tr style="background:#1e293b;color:white;">
            <th colspan="2" style="padding:6px 10px;text-align:left;border-radius:4px 4px 0 0;">${point.name}</th>
          </tr>
          <tr><td style="padding:4px 10px;font-weight:600;color:#64748b;">Type</td><td style="padding:4px 10px;">${STATION_LABELS[point.type]}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:4px 10px;font-weight:600;color:#64748b;">Latitude</td><td style="padding:4px 10px;">${point.lat.toFixed(5)}</td></tr>
          <tr><td style="padding:4px 10px;font-weight:600;color:#64748b;">Longitude</td><td style="padding:4px 10px;">${point.lng.toFixed(5)}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:4px 10px;font-weight:600;color:#64748b;">Antenne</td><td style="padding:4px 10px;">${point.antennaHeight} m</td></tr>
        </table>`;
      marker.unbindTooltip();
      marker.bindTooltip(tooltipContent, {
        direction: 'top',
        offset: [0, -16],
        opacity: 1,
        className: 'station-tooltip',
      });
    });
  }, [points, onPointDrag]);

  // Sync viewshed lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    linesRef.current.forEach((l) => l.remove());
    linesRef.current = [];
    suggestionsRef.current.forEach((m) => m.remove());
    suggestionsRef.current = [];

    viewshedResults.forEach((result) => {
      const from = points.find((p) => p.id === result.fromId);
      const to = points.find((p) => p.id === result.toId);
      if (!from || !to) return;
      const line = L.polyline(
        [[from.lat, from.lng], [to.lat, to.lng]],
        {
          color: result.visible ? '#22c55e' : '#ef4444',
          weight: 3,
          dashArray: result.visible ? undefined : '10 5',
        }
      ).addTo(map);
      linesRef.current.push(line);

      // Add relay suggestion markers on obstacle peaks
      if (!result.visible && result.suggestions) {
        result.suggestions.forEach((s, i) => {
          const icon = L.divIcon({
            className: 'custom-marker suggestion-clickable',
            html: `<svg viewBox="0 0 32 40" width="28" height="35" style="cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))"><polygon points="16,0 30,24 2,24" fill="#f59e0b" stroke="white" stroke-width="2.5"/><text x="16" y="19" text-anchor="middle" fill="white" font-size="13" font-weight="bold">${i + 1}</text><circle cx="16" cy="35" r="3" fill="#f59e0b" opacity="0.4"/></svg>`,
            iconSize: [28, 35],
            iconAnchor: [14, 35],
          });
          const marker = L.marker([s.lat, s.lng], { icon }).addTo(map);
          const tooltipHtml = `
            <table style="border-collapse:collapse;font-size:12px;min-width:200px;">
              <tr style="background:#f59e0b;color:white;">
                <th colspan="2" style="padding:6px 10px;text-align:left;border-radius:4px 4px 0 0;">📍 Relais suggéré ${i + 1}</th>
              </tr>
              <tr><td style="padding:4px 10px;font-weight:600;color:#64748b;">Altitude</td><td style="padding:4px 10px;">${s.elevation.toFixed(0)} m</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:4px 10px;font-weight:600;color:#64748b;">Latitude</td><td style="padding:4px 10px;">${s.lat.toFixed(5)}</td></tr>
              <tr><td style="padding:4px 10px;font-weight:600;color:#64748b;">Longitude</td><td style="padding:4px 10px;">${s.lng.toFixed(5)}</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:4px 10px;font-weight:600;color:#64748b;">Distance</td><td style="padding:4px 10px;">${(s.distance / 1000).toFixed(2)} km</td></tr>
              <tr><td colspan="2" style="padding:6px 10px;font-style:italic;color:#92400e;font-size:11px;">${s.reason}</td></tr>
              <tr><td colspan="2" style="padding:6px 10px;text-align:center;"><strong style="color:#f59e0b;font-size:11px;">🖱️ Cliquez pour placer un relais ici</strong></td></tr>
            </table>`;
          marker.bindTooltip(tooltipHtml, {
            direction: 'top',
            offset: [0, -35],
            opacity: 1,
            className: 'station-tooltip',
          });
          marker.on('click', () => {
            onSuggestionClick(s.lat, s.lng, s.elevation, result.fromId, result.toId);
          });
          suggestionsRef.current.push(marker);
        });
      }
    });
  }, [viewshedResults, points]);

  // Center on point
  useEffect(() => {
    if (centerOn && mapRef.current) {
      mapRef.current.setView(centerOn, mapRef.current.getZoom());
    }
  }, [centerOn]);

  return <div ref={containerRef} className="h-full w-full" />;
}
