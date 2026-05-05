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

let idCounter = 0; // counter for unique point IDs

export default function Index() {
  const [points, setPoints] = useState<TacticalPoint[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placingType, setPlacingType] = useState<StationType>('pc_principal');
  const [placingRemaining, setPlacingRemaining] = useState(0);
  const [placingCustomName, setPlacingCustomName] = useState<string | undefined>(undefined);
  const [placingIndex, setPlacingIndex] = useState(0);
  const [viewshedResults, setViewshedResults] = useState<ViewshedResult[]>([]);
  const [linkAnalysis, setLinkAnalysis] = useState<LinkAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [centerOn, setCenterOn] = useState<[number, number] | null>(null);
  const [hoveredLinePoint, setHoveredLinePoint] = useState<{ lat: number; lng: number; distance: number } | null>(null);
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
  const handleStartPlacing = useCallback((type: StationType, count: number = 1, customName?: string) => {
    setPlacingType(type);
    setPlacingRemaining(count);
    setPlacingCustomName(customName);
    setPlacingIndex(0);
    setIsPlacing(true);
  }, []);

  const handleCancelPlacing = useCallback(() => {
    setIsPlacing(false);
    setPlacingRemaining(0);
    setPlacingCustomName(undefined);
    setPlacingIndex(0);
  }, []);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!isPlacing) return;
      const currentIndex = placingIndex;
      const baseName = placingCustomName
        ? (placingRemaining + currentIndex > 1 ? `${placingCustomName} ${currentIndex + 1}` : placingCustomName)
        : `${STATION_LABELS[placingType]} ${points.filter((p) => p.type === placingType).length + 1}`;

      const newPoint: TacticalPoint = {
        id: `point-${++idCounter}`,
        name: baseName,
        type: placingType,
        lat,
        lng,
        antennaHeight: 10,
      };
      setPoints((prev) => [...prev, newPoint]);
      setPlacingIndex((prev) => prev + 1);

      const newRemaining = placingRemaining - 1;
      if (newRemaining <= 0) {
        setIsPlacing(false);
        setPlacingRemaining(0);
        setPlacingCustomName(undefined);
        setPlacingIndex(0);
      } else {
        setPlacingRemaining(newRemaining);
      }
      toast({ title: 'Point placé', description: `${newPoint.name} ajouté à la carte.${newRemaining > 0 ? ` (${newRemaining} restant${newRemaining > 1 ? 's' : ''})` : ''}` });
    },
    [isPlacing, placingType, points, placingRemaining, placingCustomName, placingIndex]
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
      const currentPoints = pointsRef.current;
      const from = currentPoints.find((p) => p.id === fromId);
      const to = currentPoints.find((p) => p.id === toId);
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

        toast({ title: '❌ Obstacle détecté', description: 'Recherche de relais existants ou optimaux...' });

        // --- REUSE EXISTING RELAYS ---
        // Find existing relay points that lie approximately between source and destination
        const existingRelays = currentPoints.filter((p) => {
          if (p.id === fromId || p.id === toId) return false;
          if (p.type !== 'relais') return false;
          // Check if relay is roughly between from and to (within bounding box + margin)
          const minLat = Math.min(from.lat, to.lat) - 0.05;
          const maxLat = Math.max(from.lat, to.lat) + 0.05;
          const minLng = Math.min(from.lng, to.lng) - 0.05;
          const maxLng = Math.max(from.lng, to.lng) + 0.05;
          return p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng;
        });

        // Sort existing relays by distance from source along the profile direction
        const dx = to.lng - from.lng;
        const dy = to.lat - from.lat;
        const pathLen = Math.sqrt(dx * dx + dy * dy);
        existingRelays.sort((a, b) => {
          const projA = ((a.lng - from.lng) * dx + (a.lat - from.lat) * dy) / (pathLen * pathLen);
          const projB = ((b.lng - from.lng) * dx + (b.lat - from.lat) * dy) / (pathLen * pathLen);
          return projA - projB;
        });

        // Try to build a chain using existing relays
        let chainBuiltWithExisting = false;
        let usedRelayIds: string[] = [];
        let segmentResults: ViewshedResult[] = [];

        if (existingRelays.length > 0) {
          // Try chain: source -> relay1 -> relay2 -> ... -> dest
          const chainPoints = [from, ...existingRelays, to];
          const chainIds = [fromId, ...existingRelays.map(r => r.id), toId];
          const testSegments: ViewshedResult[] = [];
          let allVisible = true;

          for (let i = 0; i < chainPoints.length - 1; i++) {
            const segFrom = chainPoints[i];
            const segTo = chainPoints[i + 1];
            const segProfile = await getElevationProfile(segFrom.lat, segFrom.lng, segTo.lat, segTo.lng, 50);
            if (segProfile.length < 2) { allVisible = false; break; }
            const segLos = calculateLineOfSight(segProfile, segFrom.antennaHeight, segTo.antennaHeight);
            testSegments.push({
              fromId: chainIds[i], toId: chainIds[i + 1],
              visible: segLos.visible,
              elevationProfile: segProfile,
              losLine: segLos.losLine,
              suggestions: [],
            });
            if (!segLos.visible) allVisible = false;
          }

          if (allVisible) {
            chainBuiltWithExisting = true;
            usedRelayIds = existingRelays.map(r => r.id);
            segmentResults = testSegments;
            toast({ title: `✅ Liaison établie via ${usedRelayIds.length} relais existant(s)` });
          }
        }

        if (!chainBuiltWithExisting) {
          // Fall back to finding new relays
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
          const existingRelayCount = currentPoints.filter((p) => p.type === 'relais').length;

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
          usedRelayIds = relayIds;

          const relayIndices = minRelays.map((r) => r.profileIndex);
          const chainIndices = [0, ...relayIndices, fullProfile.length - 1];
          const chainIds = [fromId, ...relayIds, toId];
          const chainHeights = [from.antennaHeight, ...relayPoints.map(() => 10), to.antennaHeight];

          segmentResults = [];
          for (let i = 0; i < chainIndices.length - 1; i++) {
            const startIdx = chainIndices[i];
            const endIdx = chainIndices[i + 1];
            const sliced = fullProfile.slice(startIdx, endIdx + 1);
            const baseDistance = sliced[0].distance;
            const segProfile = sliced.map((p) => ({ ...p, distance: p.distance - baseDistance }));

            if (segProfile.length >= 2) {
              const segLos = calculateLineOfSight(segProfile, chainHeights[i], chainHeights[i + 1]);
              const segSuggestions = segLos.visible ? [] : suggestRelayPositions(segProfile, chainHeights[i], chainHeights[i + 1]);
              segmentResults.push({
                fromId: chainIds[i], toId: chainIds[i + 1],
                visible: segLos.visible,
                elevationProfile: segProfile,
                losLine: segLos.losLine,
                suggestions: segSuggestions,
              });
            }
          }
        }

        const resolvedDirect = { ...directResult, suggestions: [] };
        setViewshedResults(segmentResults);

        const allVisible = segmentResults.every((s) => s.visible);
        setLinkAnalysis({
          sourceId: fromId, destId: toId,
          directResult: resolvedDirect,
          segmentResults, relayIds: usedRelayIds,
          complete: allVisible,
        });

        toast({
          title: allVisible ? '✅ Liaison établie' : '⚠️ Partiellement résolu',
          description: allVisible ? `${usedRelayIds.length} relais` : 'Certains segments bloqués',
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

  const handleLineHover = useCallback((point: { lat: number; lng: number; distance: number } | null) => {
    setHoveredLinePoint(point);
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
        const { data, bounds, rows, cols, noDataValue } = geoTIFFGrid;
        const cellW = (bounds.east - bounds.west) / (cols - 1);
        const cellH = (bounds.north - bounds.south) / (rows - 1);

        const startCol = Math.max(0, Math.floor((contourBounds.west - bounds.west) / cellW));
        const endCol = Math.min(cols - 1, Math.ceil((contourBounds.east - bounds.west) / cellW));
        const startRow = Math.max(0, Math.floor((bounds.north - contourBounds.north) / cellH));
        const endRow = Math.min(rows - 1, Math.ceil((bounds.north - contourBounds.south) / cellH));

        const clippedRows = endRow - startRow + 1;
        const clippedCols = endCol - startCol + 1;

        const maxDim = 200;
        const stepR = clippedRows > maxDim ? Math.ceil(clippedRows / maxDim) : 1;
        const stepC = clippedCols > maxDim ? Math.ceil(clippedCols / maxDim) : 1;

        const clipped: number[][] = [];
        for (let r = startRow; r <= endRow; r += stepR) {
          const row: number[] = [];
          for (let c = startCol; c <= endCol; c += stepC) {
            row.push(data[r][c]);
          }
          clipped.push(row);
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
      setContourBounds(grid.bounds);
      setContourDrawing(false);
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
        placingRemaining={placingRemaining}
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
          geoTIFFGrid={geoTIFFGrid}
          onLineHover={handleLineHover}
        />

        <ElevationProfile
          linkAnalysis={linkAnalysis}
          points={points}
          onClose={() => setLinkAnalysis(null)}
          hoveredLinePoint={hoveredLinePoint}
        />
      </div>
    </div>
  );
}
