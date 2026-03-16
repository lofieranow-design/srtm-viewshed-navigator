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
  centerOn: [number, number] | null;
}

export default function TacticalMap({
  points,
  viewshedResults,
  isPlacing,
  onMapClick,
  onPointDrag,
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
