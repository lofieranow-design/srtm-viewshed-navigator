import { useState, useRef } from 'react';
import { MapPin, Mountain, Download, Upload, Loader2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ContourPanelProps {
  isDrawing: boolean;
  isGenerating: boolean;
  hasSelection: boolean;
  hasContours: boolean;
  contourInterval: number;
  gridResolution: number;
  showLabels: boolean;
  dataSource: 'api' | 'geotiff';
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
  onGenerate: () => void;
  onClear: () => void;
  onExportGeoJSON: () => void;
  onIntervalChange: (interval: number) => void;
  onResolutionChange: (res: number) => void;
  onShowLabelsChange: (show: boolean) => void;
  onDataSourceChange: (source: 'api' | 'geotiff') => void;
  onGeoTIFFLoad: (file: File) => void;
  hasGeoTIFF: boolean;
}

export default function ContourPanel({
  isDrawing,
  isGenerating,
  hasSelection,
  hasContours,
  contourInterval,
  gridResolution,
  showLabels,
  dataSource,
  onStartDrawing,
  onCancelDrawing,
  onGenerate,
  onClear,
  onExportGeoJSON,
  onIntervalChange,
  onResolutionChange,
  onShowLabelsChange,
  onDataSourceChange,
  onGeoTIFFLoad,
  hasGeoTIFF,
}: ContourPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4 p-1">
      {/* Data source */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="h-3 w-3" /> Source de données
        </h4>
        <Select value={dataSource} onValueChange={(v) => onDataSourceChange(v as 'api' | 'geotiff')}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="api">API Open-Elevation (en ligne)</SelectItem>
            <SelectItem value="geotiff">Fichier GeoTIFF (local)</SelectItem>
          </SelectContent>
        </Select>

        {dataSource === 'geotiff' && (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".tif,.tiff,.geotiff"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onGeoTIFFLoad(file);
              }}
            />
            <Button
              size="sm"
              variant={hasGeoTIFF ? 'outline' : 'default'}
              className="w-full text-xs h-8"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3 mr-1" />
              {hasGeoTIFF ? '✅ GeoTIFF chargé — Remplacer' : 'Charger un fichier GeoTIFF'}
            </Button>
          </div>
        )}

        {dataSource === 'api' && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Résolution de la grille</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[gridResolution]}
                onValueChange={([v]) => onResolutionChange(v)}
                min={20}
                max={80}
                step={10}
                className="flex-1"
              />
              <span className="text-xs font-mono w-12 text-right">{gridResolution}×{gridResolution}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Plus élevé = plus précis mais plus lent ({gridResolution * gridResolution} points)
            </p>
          </div>
        )}
      </div>

      {/* Selection */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <MapPin className="h-3 w-3" /> Zone de sélection
        </h4>

        {isDrawing ? (
          <>
            <p className="text-xs text-primary animate-pulse">
              ✏️ Dessinez un rectangle sur la carte...
            </p>
            <Button size="sm" variant="destructive" className="w-full text-xs h-8" onClick={onCancelDrawing}>
              Annuler
            </Button>
          </>
        ) : (
          <Button size="sm" className="w-full text-xs h-8" onClick={onStartDrawing}>
            <MapPin className="h-3 w-3 mr-1" /> Sélectionner une zone
          </Button>
        )}

        {hasSelection && !isDrawing && (
          <p className="text-xs text-accent">✅ Zone sélectionnée</p>
        )}
      </div>

      {/* Contour settings */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Mountain className="h-3 w-3" /> Courbes de niveau
        </h4>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Intervalle (m)</Label>
          <Select value={String(contourInterval)} onValueChange={(v) => onIntervalChange(Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 m</SelectItem>
              <SelectItem value="10">10 m</SelectItem>
              <SelectItem value="20">20 m</SelectItem>
              <SelectItem value="50">50 m</SelectItem>
              <SelectItem value="100">100 m</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Afficher les altitudes</Label>
          <Switch checked={showLabels} onCheckedChange={onShowLabelsChange} />
        </div>

        <Button
          className="w-full text-xs h-9"
          disabled={!hasSelection || isGenerating || (dataSource === 'geotiff' && !hasGeoTIFF)}
          onClick={onGenerate}
        >
          {isGenerating ? (
            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Génération...</>
          ) : (
            <><Mountain className="h-3 w-3 mr-1" /> Générer les courbes</>
          )}
        </Button>

        {hasContours && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={onExportGeoJSON}>
              <Download className="h-3 w-3 mr-1" /> Export GeoJSON
            </Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs h-8 text-destructive" onClick={onClear}>
              Effacer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
