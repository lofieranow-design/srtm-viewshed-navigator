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
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${STATION_COLORS[point.type]};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
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
      marker.bindPopup(
        `<div style="font-size:12px"><strong>${point.name}</strong><br/>Type: ${STATION_LABELS[point.type]}<br/>Lat: ${point.lat.toFixed(5)}<br/>Lng: ${point.lng.toFixed(5)}<br/>Antenne: ${point.antennaHeight}m</div>`
      );
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
