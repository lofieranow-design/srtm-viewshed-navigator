import { useState } from 'react';
import { MapPin, Radio, Trash2, Plus, Eye, ChevronLeft, ChevronRight, Check, Navigation, Lightbulb, Mountain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TacticalPoint, StationType, STATION_LABELS, STATION_COLORS, ViewshedResult } from '@/types/tactical';
import ContourPanel from './ContourPanel';

const STEPS = [
  { title: 'Bienvenue', icon: Navigation, description: 'Introduction à l\'analyse terrain' },
  { title: 'Placer les stations', icon: MapPin, description: 'Positionnez vos points tactiques sur la carte' },
  { title: 'Configurer', icon: Radio, description: 'Ajustez les paramètres des antennes' },
  { title: 'Analyser', icon: Radio, description: 'Lancez l\'analyse de visibilité radio' },
  { title: 'Résultats', icon: Check, description: 'Consultez les résultats de l\'analyse' },
];

interface ContourConfig {
  isDrawing: boolean;
  isGenerating: boolean;
  hasSelection: boolean;
  hasContours: boolean;
  contourInterval: number;
  gridResolution: number;
  showLabels: boolean;
  dataSource: 'api' | 'geotiff';
  hasGeoTIFF: boolean;
}

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
  // Contour props
  contourConfig: ContourConfig;
  onContourStartDrawing: () => void;
  onContourCancelDrawing: () => void;
  onContourGenerate: () => void;
  onContourClear: () => void;
  onContourExport: () => void;
  onContourExportPNG: () => void;
  onContourIntervalChange: (interval: number) => void;
  onContourResolutionChange: (res: number) => void;
  onContourShowLabelsChange: (show: boolean) => void;
  onContourDataSourceChange: (source: 'api' | 'geotiff') => void;
  onContourGeoTIFFLoad: (file: File) => void;
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
  contourConfig,
  onContourStartDrawing,
  onContourCancelDrawing,
  onContourGenerate,
  onContourClear,
  onContourExport,
  onContourExportPNG,
  onContourIntervalChange,
  onContourResolutionChange,
  onContourShowLabelsChange,
  onContourDataSourceChange,
  onContourGeoTIFFLoad,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'terrain' | 'contours'>('terrain');
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<StationType>('pc_principal');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');

  const canNext = () => {
    if (step === 1) return points.length >= 2;
    if (step === 3) return viewshedResults.length > 0 || isAnalyzing;
    return true;
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4 p-1">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <h3 className="text-sm font-semibold">Procédure d'analyse terrain</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cette application vous permet d'effectuer une analyse de visibilité radio
                basée sur les données d'élévation réelles (SRTM 30m).
              </p>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Placez vos stations tactiques sur la carte</li>
                <li>Configurez les hauteurs d'antenne</li>
                <li>Analysez la visibilité entre les points</li>
                <li>Consultez le profil d'élévation et les résultats</li>
              </ol>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Types de stations</h4>
              {(Object.keys(STATION_LABELS) as StationType[]).map((t) => (
                <div key={t} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full" style={{ background: STATION_COLORS[t] }} />
                  <span>{STATION_LABELS[t]}</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4 p-1">
            <div className="flex gap-2">
              <Select value={selectedType} onValueChange={(v) => setSelectedType(v as StationType)}>
                <SelectTrigger className="flex-1 h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATION_LABELS) as StationType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATION_COLORS[t] }} />
                        {STATION_LABELS[t]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isPlacing ? (
                <Button size="sm" variant="destructive" onClick={onCancelPlacing} className="text-xs h-9">
                  Annuler
                </Button>
              ) : (
                <Button size="sm" onClick={() => onStartPlacing(selectedType)} className="text-xs h-9">
                  <Plus className="h-3 w-3 mr-1" /> Placer
                </Button>
              )}
            </div>

            {isPlacing && (
              <p className="text-xs text-primary animate-pulse">
                👆 Cliquez sur la carte pour placer {STATION_LABELS[placingType]}
              </p>
            )}

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Points placés ({points.length})
              </h3>
              {points.length === 0 && (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
                  Placez au moins 2 points pour continuer.
                </p>
              )}
              {points.map((point) => (
                <div key={point.id} className="flex items-center justify-between rounded-md border border-border bg-background p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATION_COLORS[point.type] }} />
                    <span className="text-xs font-medium">{point.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onCenterOnPoint(point)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onDeletePoint(point.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-3 p-1">
            {points.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun point à configurer.</p>
            ) : (
              points.map((point) => (
                <div key={point.id} className="rounded-md border border-border bg-background p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: STATION_COLORS[point.type] }} />
                    <Input
                      value={point.name}
                      onChange={(e) => onUpdatePoint(point.id, { name: e.target.value })}
                      className="h-7 text-xs font-medium border-0 p-0 bg-transparent"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Lat: {point.lat.toFixed(4)}</span>
                    <span>Lng: {point.lng.toFixed(4)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Hauteur antenne:</label>
                    <Input
                      type="number"
                      value={point.antennaHeight}
                      onChange={(e) => onUpdatePoint(point.id, { antennaHeight: Number(e.target.value) })}
                      className="h-7 w-20 text-xs"
                      min={1} max={100}
                    />
                    <span className="text-xs text-muted-foreground">m</span>
                  </div>
                </div>
              ))
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-3 p-1">
            {points.length < 2 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Il faut au moins 2 points. Revenez à l'étape 2.
              </p>
            ) : (
              <>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Point de départ" />
                  </SelectTrigger>
                  <SelectContent>
                    {points.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Point d'arrivée" />
                  </SelectTrigger>
                  <SelectContent>
                    {points.filter((p) => p.id !== fromId).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  className="w-full text-xs h-9"
                  disabled={!fromId || !toId || isAnalyzing}
                  onClick={() => onRunViewshed(fromId, toId)}
                >
                  {isAnalyzing ? 'Analyse en cours...' : '🔍 Lancer l\'analyse'}
                </Button>

                {viewshedResults.length > 0 && (
                  <p className="text-xs text-accent text-center">
                    ✅ {viewshedResults.length} analyse(s) effectuée(s) — passez à l'étape suivante
                  </p>
                )}
              </>
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-3 p-1">
            {viewshedResults.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Aucune analyse effectuée. Revenez à l'étape précédente.
              </p>
            ) : (
              <>
                {viewshedResults.map((r, i) => {
                  const from = points.find((p) => p.id === r.fromId);
                  const to = points.find((p) => p.id === r.toId);
                  return (
                    <div
                      key={i}
                      className={`rounded-md border p-3 text-xs space-y-1 ${
                        r.visible
                          ? 'border-accent bg-accent/10'
                          : 'border-destructive bg-destructive/10'
                      }`}
                    >
                      <div className="font-semibold">
                        {from?.name} → {to?.name}
                      </div>
                      <div className={r.visible ? 'text-accent' : 'text-destructive'}>
                        {r.visible ? '✅ Liaison radio possible' : '❌ Obstacle détecté — relais requis'}
                      </div>
                      {r.elevationProfile.length > 0 && (
                        <div className="text-muted-foreground">
                          Distance: {(r.elevationProfile[r.elevationProfile.length - 1].distance / 1000).toFixed(1)} km
                        </div>
                      )}
                      {!r.visible && r.suggestions && r.suggestions.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-destructive/20 pt-2">
                          <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                            <Lightbulb className="h-3 w-3" />
                            Positions relais suggérées
                          </div>
                          {r.suggestions.map((s, j) => (
                            <div key={j} className="rounded bg-background border border-border p-2 text-xs space-y-0.5">
                              <div className="font-medium">📍 Relais suggéré {j + 1}</div>
                              <div className="text-muted-foreground">
                                Alt: {s.elevation.toFixed(0)}m — Dist: {(s.distance / 1000).toFixed(1)}km
                              </div>
                              <div className="text-muted-foreground">
                                Lat: {s.lat.toFixed(5)}, Lng: {s.lng.toFixed(5)}
                              </div>
                              <div className="text-xs text-primary/80 italic">{s.reason}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={onClearViewshed}>
                  Effacer les résultats
                </Button>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="border-b border-border bg-sidebar p-4">
        <h1 className="text-lg font-bold text-sidebar-foreground flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          Analyse Terrain
        </h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1">Visibilité Radio & Courbes de niveau</p>
      </div>

      {/* Tab selector */}
      <div className="border-b border-border flex">
        <button
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'terrain'
              ? 'text-primary border-b-2 border-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('terrain')}
        >
          <Radio className="h-3.5 w-3.5" /> Visibilité
        </button>
        <button
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'contours'
              ? 'text-primary border-b-2 border-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('contours')}
        >
          <Mountain className="h-3.5 w-3.5" /> Courbes
        </button>
      </div>

      {activeTab === 'terrain' ? (
        <>
          {/* Step indicator */}
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-primary">
                Étape {step + 1}/{STEPS.length}
              </span>
              <span className="text-xs text-muted-foreground">{STEPS[step].title}</span>
            </div>
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? 'bg-primary' : 'bg-border'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">{STEPS[step].description}</p>
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto p-3">
            {renderStep()}
          </div>

          {/* Navigation */}
          <div className="border-t border-border p-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-9"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              <ChevronLeft className="h-3 w-3 mr-1" /> Précédent
            </Button>
            <Button
              size="sm"
              className="flex-1 text-xs h-9"
              disabled={step === STEPS.length - 1 || !canNext()}
              onClick={() => setStep((s) => s + 1)}
            >
              Suivant <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          {contourConfig && (
            <ContourPanel
              isDrawing={contourConfig.isDrawing}
              isGenerating={contourConfig.isGenerating}
              hasSelection={contourConfig.hasSelection}
              hasContours={contourConfig.hasContours}
              contourInterval={contourConfig.contourInterval}
              gridResolution={contourConfig.gridResolution}
              showLabels={contourConfig.showLabels}
              dataSource={contourConfig.dataSource}
              hasGeoTIFF={contourConfig.hasGeoTIFF}
              onStartDrawing={onContourStartDrawing}
              onCancelDrawing={onContourCancelDrawing}
              onGenerate={onContourGenerate}
              onClear={onContourClear}
              onExportGeoJSON={onContourExport}
              onIntervalChange={onContourIntervalChange}
              onResolutionChange={onContourResolutionChange}
              onShowLabelsChange={onContourShowLabelsChange}
              onDataSourceChange={onContourDataSourceChange}
              onGeoTIFFLoad={onContourGeoTIFFLoad}
            />
          )}
        </div>
      )}
    </div>
  );
}
