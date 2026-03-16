import { useState } from 'react';
import { MapPin, Radio, Trash2, Plus, ChevronDown, Move, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TacticalPoint, StationType, STATION_LABELS, STATION_COLORS, ViewshedResult } from '@/types/tactical';

interface SidebarProps {
  points: TacticalPoint[];
  viewshedResults: ViewshedResult[];
  isPlacing: boolean;
  placingType: StationType;
  onStartPlacing: (type: StationType) => void;
  onCancelPlacing: () => void;
  onDeletePoint: (id: string) => void;
  onUpdatePoint: (id: string, updates: Partial<TacticalPoint>) => void;
  onRunViewshed: (fromId: string, toId: string) => void;
  onClearViewshed: () => void;
  onCenterOnPoint: (point: TacticalPoint) => void;
  isAnalyzing: boolean;
}

export default function Sidebar({
  points,
  viewshedResults,
  isPlacing,
  placingType,
  onStartPlacing,
  onCancelPlacing,
  onDeletePoint,
  onUpdatePoint,
  onRunViewshed,
  onClearViewshed,
  onCenterOnPoint,
  isAnalyzing,
}: SidebarProps) {
  const [selectedType, setSelectedType] = useState<StationType>('pc_principal');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-card overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border bg-sidebar p-4">
        <h1 className="text-lg font-bold text-sidebar-foreground flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          Analyse Terrain
        </h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1">
          QGIS / SRTM — Visibilité Radio
        </p>
      </div>

      {/* Add Point */}
      <div className="border-b border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Stations Tactiques
        </h2>

        <div className="flex gap-2">
          <Select value={selectedType} onValueChange={(v) => setSelectedType(v as StationType)}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATION_LABELS) as StationType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: STATION_COLORS[t] }}
                    />
                    {STATION_LABELS[t]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isPlacing ? (
            <Button size="sm" variant="destructive" onClick={onCancelPlacing} className="text-xs h-8">
              Annuler
            </Button>
          ) : (
            <Button size="sm" onClick={() => onStartPlacing(selectedType)} className="text-xs h-8">
              <Plus className="h-3 w-3 mr-1" />
              Placer
            </Button>
          )}
        </div>

        {isPlacing && (
          <p className="text-xs text-primary animate-pulse">
            👆 Cliquez sur la carte pour placer {STATION_LABELS[placingType]}
          </p>
        )}
      </div>

      {/* Points List */}
      <div className="border-b border-border p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Points ({points.length})
        </h3>

        {points.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Aucun point placé. Sélectionnez un type et cliquez "Placer".
          </p>
        )}

        {points.map((point) => (
          <div
            key={point.id}
            className="rounded-md border border-border bg-background p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: STATION_COLORS[point.type] }}
                />
                <Input
                  value={point.name}
                  onChange={(e) => onUpdatePoint(point.id, { name: e.target.value })}
                  className="h-6 text-xs font-medium border-0 p-0 bg-transparent"
                />
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => onCenterOnPoint(point)}
                >
                  <Eye className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive"
                  onClick={() => onDeletePoint(point.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Lat: {point.lat.toFixed(4)}</span>
              <span>Lng: {point.lng.toFixed(4)}</span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Antenne (m):</label>
              <Input
                type="number"
                value={point.antennaHeight}
                onChange={(e) =>
                  onUpdatePoint(point.id, { antennaHeight: Number(e.target.value) })
                }
                className="h-6 w-16 text-xs"
                min={1}
                max={100}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Viewshed Analysis */}
      <div className="p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Radio className="h-4 w-4" />
          Analyse de Visibilité
        </h2>

        {points.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            Placez au moins 2 points pour analyser la visibilité.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Point de départ" />
                </SelectTrigger>
                <SelectContent>
                  {points.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Point d'arrivée" />
                </SelectTrigger>
                <SelectContent>
                  {points.filter((p) => p.id !== fromId).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                className="w-full text-xs h-8"
                disabled={!fromId || !toId || isAnalyzing}
                onClick={() => onRunViewshed(fromId, toId)}
              >
                {isAnalyzing ? 'Analyse en cours...' : 'Analyser la visibilité'}
              </Button>
            </div>

            {viewshedResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Résultats</h3>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClearViewshed}>
                    Effacer
                  </Button>
                </div>
                {viewshedResults.map((r, i) => {
                  const from = points.find((p) => p.id === r.fromId);
                  const to = points.find((p) => p.id === r.toId);
                  return (
                    <div
                      key={i}
                      className={`rounded-md border p-2 text-xs ${
                        r.visible
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-destructive bg-destructive/10 text-destructive'
                      }`}
                    >
                      <strong>{from?.name}</strong> → <strong>{to?.name}</strong>
                      <br />
                      {r.visible ? '✅ Liaison radio possible' : '❌ Obstacle détecté — relais requis'}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
