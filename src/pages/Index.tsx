import { useState, useCallback, useRef } from 'react';
import { TacticalPoint, StationType, STATION_LABELS, ViewshedResult, LinkAnalysis } from '@/types/tactical';
import { getElevationProfile, calculateLineOfSight, suggestRelayPositions, findMinimalRelays } from '@/lib/elevation';
import { generateContours, contoursToGeoJSON, ContourLine } from '@/lib/contours';
import { fetchElevationGrid, parseGeoTIFF } from '@/lib/elevation-grid';
import { ElevationGrid } from '@/lib/contours';
import TacticalMap from '@/components/TacticalMap';
import Sidebar from '@/components/Sidebar';
import ElevationProfile from '@/components/ElevationProfile';
import { toast } from '@/hooks/use-toast';

let idCounter = 0;

export default function Index() {
  const [points, setPoints] = useState<TacticalPoint[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placingType, setPlacingType] = useState<StationType>('pc_principal');
  const [viewshedResults, setViewshedResults] = useState<ViewshedResult[]>([]);
  const [linkAnalysis, setLinkAnalysis] = useState<LinkAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [centerOn, setCenterOn] = useState<[number, number] | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // Contour state
  const [contourDrawing, setContourDrawing] = useState(false);
  const [contourGenerating, setContourGenerating] = useState(false);
  const [contourBounds, setContourBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [contourLines, setContourLines] = useState<ContourLine[]>([]);
  const [contourInterval, setContourInterval] = useState(20);
  const [gridResolution, setGridResolution] = useState(50);
  const [showContourLabels, setShowContourLabels] = useState(true);
  const [contourDataSource, setContourDataSource] = useState<'api' | 'geotiff'>('api');
  const [geoTIFFGrid, setGeoTIFFGrid] = useState<ElevationGrid | null>(null);

  // === Terrain analysis handlers ===
  const handleStartPlacing = useCallback((type: StationType) => {
    setPlacingType(type);
    setIsPlacing(true);
  }, []);

  const handleCancelPlacing = useCallback(() => {
    setIsPlacing(false);
  }, []);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!isPlacing) return;
      const newPoint: TacticalPoint = {
        id: `point-${++idCounter}`,
        name: `${STATION_LABELS[placingType]} ${points.filter((p) => p.type === placingType).length + 1}`,
        type: placingType,
        lat,
        lng,
        antennaHeight: 10,
      };
      setPoints((prev) => [...prev, newPoint]);
      setIsPlacing(false);
      toast({ title: 'Point placé', description: `${newPoint.name} ajouté à la carte.` });
    },
    [isPlacing, placingType, points]
  );

  const handleDeletePoint = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    setViewshedResults((prev) => prev.filter((r) => r.fromId !== id && r.toId !== id));
    setLinkAnalysis((prev) => {
      if (!prev) return null;
      if (prev.sourceId === id || prev.destId === id || prev.relayIds.includes(id)) return null;
      return prev;
    });
  }, []);

  const handleUpdatePoint = useCallback((id: string, updates: Partial<TacticalPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const handlePointDrag = useCallback((id: string, lat: number, lng: number) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, lat, lng } : p)));
    setViewshedResults((prev) => prev.filter((r) => r.fromId !== id && r.toId !== id));
  }, []);

  const handleRunViewshed = useCallback(
    async (fromId: string, toId: string) => {
      const from = points.find((p) => p.id === fromId);
      const to = points.find((p) => p.id === toId);
      if (!from || !to) return;

      setIsAnalyzing(true);
      setViewshedResults([]);
      setLinkAnalysis(null);

      try {
        const fullProfile = await getElevationProfile(from.lat, from.lng, to.lat, to.lng, 150);
        if (fullProfile.length === 0) {
          toast({ title: 'Erreur', description: "Impossible de récupérer les données d'élévation.", variant: 'destructive' });
          setIsAnalyzing(false);
          return;
        }

        const directLos = calculateLineOfSight(fullProfile, from.antennaHeight, to.antennaHeight);
        const directSuggestions = directLos.visible ? [] : suggestRelayPositions(fullProfile, from.antennaHeight, to.antennaHeight);
        const directResult: ViewshedResult = {
          fromId, toId,
          visible: directLos.visible,
          elevationProfile: fullProfile,
          losLine: directLos.losLine,
          suggestions: directSuggestions,
        };
        setViewshedResults([directResult]);

        if (directLos.visible) {
          setLinkAnalysis({
            sourceId: fromId, destId: toId,
            directResult,
            segmentResults: [directResult],
            relayIds: [],
            complete: true,
          });
          toast({ title: '✅ Liaison directe possible', description: `${from.name} → ${to.name}` });
          setIsAnalyzing(false);
          return;
        }

        toast({ title: '❌ Obstacle détecté', description: 'Recherche du nombre minimal de relais...' });
        const minRelays = findMinimalRelays(fullProfile, from.antennaHeight, to.antennaHeight, 5);

        if (minRelays.length === 0) {
          setLinkAnalysis({
            sourceId: fromId, destId: toId,
            directResult,
            segmentResults: [directResult],
            relayIds: [],
            complete: false,
          });
          toast({ title: '❌ Aucun relais trouvé', variant: 'destructive' });
          setIsAnalyzing(false);
          return;
        }

        const relayPoints: TacticalPoint[] = [];
        const relayIds: string[] = [];
        const existingRelayCount = pointsRef.current.filter((p) => p.type === 'relais').length;

        for (let i = 0; i < minRelays.length; i++) {
          const r = minRelays[i];
          const relayId = `point-${++idCounter}`;
          const relayPoint: TacticalPoint = {
            id: relayId,
            name: `Relais ${existingRelayCount + i + 1}`,
            type: 'relais',
            lat: r.lat, lng: r.lng,
            antennaHeight: 10,
          };
          relayPoints.push(relayPoint);
          relayIds.push(relayId);
        }

        setPoints((prev) => [...prev, ...relayPoints]);
        toast({ title: `📍 ${relayPoints.length} relais placé(s)` });

        const relayIndices = minRelays.map((r) => r.profileIndex);
        const chainIndices = [0, ...relayIndices, fullProfile.length - 1];
        const chainIds = [fromId, ...relayIds, toId];
        const chainHeights = [from.antennaHeight, ...relayPoints.map(() => 10), to.antennaHeight];

        const segmentResults: ViewshedResult[] = [];
        const allNewResults: ViewshedResult[] = [];

        for (let i = 0; i < chainIndices.length - 1; i++) {
          const startIdx = chainIndices[i];
          const endIdx = chainIndices[i + 1];
          const sliced = fullProfile.slice(startIdx, endIdx + 1);
          const baseDistance = sliced[0].distance;
          const segProfile = sliced.map((p) => ({ ...p, distance: p.distance - baseDistance }));

          if (segProfile.length >= 2) {
            const segLos = calculateLineOfSight(segProfile, chainHeights[i], chainHeights[i + 1]);
            const segSuggestions = segLos.visible ? [] : suggestRelayPositions(segProfile, chainHeights[i], chainHeights[i + 1]);
            const segResult: ViewshedResult = {
              fromId: chainIds[i], toId: chainIds[i + 1],
              visible: segLos.visible,
              elevationProfile: segProfile,
              losLine: segLos.losLine,
              suggestions: segSuggestions,
            };
            segmentResults.push(segResult);
            allNewResults.push(segResult);
          }
        }

        const resolvedDirect = { ...directResult, suggestions: [] };
        setViewshedResults(allNewResults);

        const allVisible = segmentResults.every((s) => s.visible);
        setLinkAnalysis({
          sourceId: fromId, destId: toId,
          directResult: resolvedDirect,
          segmentResults, relayIds,
          complete: allVisible,
        });

        toast({
          title: allVisible ? '✅ Liaison établie' : '⚠️ Partiellement résolu',
          description: allVisible ? `${relayIds.length} relais` : 'Certains segments bloqués',
          variant: allVisible ? undefined : 'destructive',
        });
      } catch {
        toast({ title: 'Erreur', description: "Échec de l'analyse.", variant: 'destructive' });
      }
      setIsAnalyzing(false);
    },
    [points]
  );

  const handleSuggestionClick = useCallback(
    async (lat: number, lng: number) => {
      const relayId = `point-${++idCounter}`;
      const relayName = `Relais ${points.filter((p) => p.type === 'relais').length + 1}`;
      setPoints((prev) => [...prev, {
        id: relayId, name: relayName, type: 'relais' as const,
        lat, lng, antennaHeight: 10,
      }]);
      toast({ title: 'Relais placé', description: `${relayName} ajouté.` });
    },
    [points]
  );

  const handleCenterOnPoint = useCallback((point: TacticalPoint) => {
    setCenterOn([point.lat, point.lng]);
  }, []);

  // === Contour handlers ===
  const handleContourRectangle = useCallback((bounds: { north: number; south: number; east: number; west: number }) => {
    setContourBounds(bounds);
    setContourDrawing(false);
  }, []);

  const handleContourGenerate = useCallback(async () => {
    if (!contourBounds) return;
    setContourGenerating(true);

    try {
      let grid: ElevationGrid;

      if (contourDataSource === 'geotiff' && geoTIFFGrid) {
        // Clip GeoTIFF grid to selected bounds
        const { data, bounds, rows, cols, noDataValue } = geoTIFFGrid;
        const cellW = (bounds.east - bounds.west) / (cols - 1);
        const cellH = (bounds.north - bounds.south) / (rows - 1);

        const startCol = Math.max(0, Math.floor((contourBounds.west - bounds.west) / cellW));
        const endCol = Math.min(cols - 1, Math.ceil((contourBounds.east - bounds.west) / cellW));
        const startRow = Math.max(0, Math.floor((bounds.north - contourBounds.north) / cellH));
        const endRow = Math.min(rows - 1, Math.ceil((bounds.north - contourBounds.south) / cellH));

        const clipped: number[][] = [];
        for (let r = startRow; r <= endRow; r++) {
          clipped.push(data[r].slice(startCol, endCol + 1));
        }

        grid = {
          data: clipped,
          bounds: contourBounds,
          rows: clipped.length,
          cols: clipped[0]?.length || 0,
          noDataValue,
        };
      } else {
        grid = await fetchElevationGrid(contourBounds, gridResolution);
      }

      const contours = generateContours(grid, contourInterval);
      setContourLines(contours);

      toast({
        title: '✅ Courbes générées',
        description: `${contours.length} courbes de niveau (intervalle ${contourInterval}m)`,
      });
    } catch (err) {
      console.error('Contour generation error:', err);
      toast({ title: 'Erreur', description: 'Échec de la génération des courbes.', variant: 'destructive' });
    }
    setContourGenerating(false);
  }, [contourBounds, contourDataSource, geoTIFFGrid, gridResolution, contourInterval]);

  const handleContourExport = useCallback(() => {
    if (contourLines.length === 0) return;
    const geojson = contoursToGeoJSON(contourLines);
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contours_${contourInterval}m.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Export réussi', description: 'Fichier GeoJSON téléchargé.' });
  }, [contourLines, contourInterval]);

  const handleContourExportPNG = useCallback(async () => {
    if (!contourBounds) return;
    const mapContainer = document.querySelector('.leaflet-container') as HTMLElement;
    if (!mapContainer) return;

    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(mapContainer, {
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `contours_${contourInterval}m.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast({ title: 'Export réussi', description: 'Image PNG téléchargée.' });
    } catch {
      toast({ title: 'Erreur', description: "Échec de l'export PNG.", variant: 'destructive' });
    }
  }, [contourBounds, contourInterval]);

  const handleGeoTIFFLoad = useCallback(async (file: File) => {
    try {
      const grid = await parseGeoTIFF(file);
      setGeoTIFFGrid(grid);
      // Auto-select the GeoTIFF extent as contour bounds
      setContourBounds(grid.bounds);
      setContourDrawing(false);
      // Center map on GeoTIFF extent
      const centerLat = (grid.bounds.north + grid.bounds.south) / 2;
      const centerLng = (grid.bounds.east + grid.bounds.west) / 2;
      setCenterOn([centerLat, centerLng]);
      toast({ title: '✅ GeoTIFF chargé', description: `${grid.cols}×${grid.rows} pixels — zone auto-sélectionnée` });
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de lire le fichier GeoTIFF.', variant: 'destructive' });
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        points={points}
        viewshedResults={viewshedResults}
        isPlacing={isPlacing}
        placingType={placingType}
        onStartPlacing={handleStartPlacing}
        onCancelPlacing={handleCancelPlacing}
        onDeletePoint={handleDeletePoint}
        onUpdatePoint={handleUpdatePoint}
        onRunViewshed={handleRunViewshed}
        onClearViewshed={() => { setViewshedResults([]); setLinkAnalysis(null); }}
        onCenterOnPoint={handleCenterOnPoint}
        isAnalyzing={isAnalyzing}
        contourConfig={{
          isDrawing: contourDrawing,
          isGenerating: contourGenerating,
          hasSelection: !!contourBounds,
          hasContours: contourLines.length > 0,
          contourInterval,
          gridResolution,
          showLabels: showContourLabels,
          dataSource: contourDataSource,
          hasGeoTIFF: !!geoTIFFGrid,
        }}
        onContourStartDrawing={() => setContourDrawing(true)}
        onContourCancelDrawing={() => setContourDrawing(false)}
        onContourGenerate={handleContourGenerate}
        onContourClear={() => { setContourLines([]); setContourBounds(null); }}
        onContourExport={handleContourExport}
        onContourExportPNG={handleContourExportPNG}
        onContourIntervalChange={setContourInterval}
        onContourResolutionChange={setGridResolution}
        onContourShowLabelsChange={setShowContourLabels}
        onContourDataSourceChange={setContourDataSource}
        onContourGeoTIFFLoad={handleGeoTIFFLoad}
      />

      <div className="relative flex-1">
        <TacticalMap
          points={points}
          viewshedResults={viewshedResults}
          isPlacing={isPlacing}
          onMapClick={handleMapClick}
          onPointDrag={handlePointDrag}
          onSuggestionClick={handleSuggestionClick}
          centerOn={centerOn}
          contourDrawing={contourDrawing}
          onContourRectangle={handleContourRectangle}
          contourLines={contourLines}
          showContourLabels={showContourLabels}
        />

        <ElevationProfile
          linkAnalysis={linkAnalysis}
          points={points}
          onClose={() => setLinkAnalysis(null)}
        />
      </div>
    </div>
  );
}
