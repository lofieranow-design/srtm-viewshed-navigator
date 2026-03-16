import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TacticalPoint, STATION_COLORS, STATION_LABELS, StationType } from '@/types/tactical';
import { ViewshedResult } from '@/types/tactical';

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function createIcon(color: string) {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50%; 
      background: ${color}; border: 3px solid white; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

interface MapClickHandlerProps {
  onMapClick: (lat: number, lng: number) => void;
  isPlacing: boolean;
}

function MapClickHandler({ onMapClick, isPlacing }: MapClickHandlerProps) {
  useMapEvents({
    click(e) {
      if (isPlacing) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

function MapCenterUpdater({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

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
  return (
    <MapContainer
      center={[36.75, 3.06]}
      zoom={10}
      className="h-full w-full"
      style={{ cursor: isPlacing ? 'crosshair' : 'grab' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* Terrain overlay with OpenTopoMap */}
      <TileLayer
        url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenTopoMap'
        opacity={0.7}
      />

      <MapClickHandler onMapClick={onMapClick} isPlacing={isPlacing} />
      <MapCenterUpdater center={centerOn} />

      {points.map((point) => (
        <Marker
          key={point.id}
          position={[point.lat, point.lng]}
          icon={createIcon(STATION_COLORS[point.type])}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const marker = e.target;
              const pos = marker.getLatLng();
              onPointDrag(point.id, pos.lat, pos.lng);
            },
          }}
        >
          <Popup>
            <div className="text-sm">
              <strong>{point.name}</strong>
              <br />
              Type: {STATION_LABELS[point.type]}
              <br />
              Lat: {point.lat.toFixed(5)}
              <br />
              Lng: {point.lng.toFixed(5)}
              <br />
              Antenne: {point.antennaHeight}m
            </div>
          </Popup>
        </Marker>
      ))}

      {viewshedResults.map((result, i) => {
        const from = points.find((p) => p.id === result.fromId);
        const to = points.find((p) => p.id === result.toId);
        if (!from || !to) return null;
        return (
          <Polyline
            key={i}
            positions={[
              [from.lat, from.lng],
              [to.lat, to.lng],
            ]}
            pathOptions={{
              color: result.visible ? '#22c55e' : '#ef4444',
              weight: 3,
              dashArray: result.visible ? undefined : '10 5',
            }}
          />
        );
      })}
    </MapContainer>
  );
}
