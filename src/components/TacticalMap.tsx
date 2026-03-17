import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TacticalPoint, STATION_COLORS, STATION_LABELS, ViewshedResult } from '@/types/tactical';
import { ContourLine } from '@/lib/contours';

interface TacticalMapProps {
  points: TacticalPoint[];
  viewshedResults: ViewshedResult[];
  isPlacing: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onPointDrag: (id: string, lat: number, lng: number) => void;
  onSuggestionClick: (lat: number, lng: number, elevation: number, fromId: string, toId: string) => void;
  centerOn: [number, number] | null;
  // Contour props
  contourDrawing: boolean;
  onContourRectangle: (bounds: { north: number; south: number; east: number; west: number }) => void;
  contourLines: ContourLine[];
  showContourLabels: boolean;
}

export default function TacticalMap({
  points,
  viewshedResults,
  isPlacing,
  onMapClick,
  onPointDrag,
  onSuggestionClick,
  centerOn,
  contourDrawing,
  onContourRectangle,
  contourLines,
  showContourLabels,
}: TacticalMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const linesRef = useRef<L.Polyline[]>([]);
  const suggestionsRef = useRef<L.Marker[]>([]);
  const contourLayerRef = useRef<L.LayerGroup | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const drawingRef = useRef(false);

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

  // Rectangle drawing for contour selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (contourDrawing && !drawingRef.current) {
      drawingRef.current = true;
      map.getContainer().style.cursor = 'crosshair';

      let startLatLng: L.LatLng | null = null;
      let tempRect: L.Rectangle | null = null;

      const onMouseDown = (e: L.LeafletMouseEvent) => {
        startLatLng = e.latlng;
        L.DomEvent.stopPropagation(e as any);
      };

      const onMouseMove = (e: L.LeafletMouseEvent) => {
        if (!startLatLng) return;
        const bounds = L.latLngBounds(startLatLng, e.latlng);
        if (tempRect) {
          tempRect.setBounds(bounds);
        } else {
          tempRect = L.rectangle(bounds, {
            color: '#2563eb',
            weight: 2,
            fillOpacity: 0.1,
            dashArray: '5 5',
          }).addTo(map);
        }
      };

      const onMouseUp = (e: L.LeafletMouseEvent) => {
        if (!startLatLng) return;
        const bounds = L.latLngBounds(startLatLng, e.latlng);

        // Remove temp rect
        if (tempRect) tempRect.remove();

        // Draw permanent rect
        if (rectRef.current) rectRef.current.remove();
        rectRef.current = L.rectangle(bounds, {
          color: '#2563eb',
          weight: 2,
          fillOpacity: 0.05,
        }).addTo(map);

        onContourRectangle({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });

        // Cleanup
        map.off('mousedown', onMouseDown);
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
        map.dragging.enable();
        drawingRef.current = false;
        startLatLng = null;
      };

      map.dragging.disable();
      map.on('mousedown', onMouseDown);
      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);

      return () => {
        map.off('mousedown', onMouseDown);
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
        map.dragging.enable();
        drawingRef.current = false;
        if (tempRect) tempRect.remove();
      };
    } else if (!contourDrawing) {
      drawingRef.current = false;
      map.getContainer().style.cursor = isPlacing ? 'crosshair' : 'grab';
    }
  }, [contourDrawing, onContourRectangle, isPlacing]);

  // Render contour lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (contourLayerRef.current) {
      contourLayerRef.current.clearLayers();
    } else {
      contourLayerRef.current = L.layerGroup().addTo(map);
    }

    if (contourLines.length === 0) return;

    // Color scale based on elevation range
    const elevations = contourLines.map((c) => c.elevation);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    const range = maxElev - minElev || 1;

    contourLines.forEach((contour) => {
      const t = (contour.elevation - minElev) / range;
      // Green to brown gradient
      const r = Math.round(34 + t * 105);
      const g = Math.round(139 - t * 70);
      const b = Math.round(34);
      const color = `rgb(${r}, ${g}, ${b})`;
      const isMajor = contour.elevation % 100 === 0;

      const latlngs = contour.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      if (latlngs.length < 2) return;

      const polyline = L.polyline(latlngs, {
        color,
        weight: isMajor ? 2 : 1,
        opacity: isMajor ? 0.9 : 0.6,
      });

      polyline.addTo(contourLayerRef.current!);

      // Add elevation labels
      if (showContourLabels && latlngs.length > 3) {
        const midIdx = Math.floor(latlngs.length / 2);
        const midPt = latlngs[midIdx];
        const label = L.marker(midPt, {
          icon: L.divIcon({
            className: 'contour-label',
            html: `<span style="font-size:9px;color:${color};font-weight:${isMajor ? 'bold' : 'normal'};background:rgba(255,255,255,0.8);padding:0 2px;border-radius:2px;white-space:nowrap;">${contour.elevation}m</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
        });
        label.addTo(contourLayerRef.current!);
      }
    });
  }, [contourLines, showContourLabels]);

  return <div ref={containerRef} className="h-full w-full" />;
}
