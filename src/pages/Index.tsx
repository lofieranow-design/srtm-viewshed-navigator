import { useState, useCallback, useRef } from 'react';
import { TacticalPoint, StationType, STATION_LABELS, ViewshedResult, LinkAnalysis } from '@/types/tactical';
import { getElevationProfile, calculateLineOfSight, suggestRelayPositions, findMinimalRelays } from '@/lib/elevation';
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
        // Step 1: Get full elevation profile and direct analysis
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
          // Direct link works!
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

        // Step 2: Use greedy forward-scan to find minimum relays
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
          toast({ title: '❌ Aucun relais trouvé', description: 'Impossible de résoudre la liaison', variant: 'destructive' });
          setIsAnalyzing(false);
          return;
        }

        // Step 3: Place relay points
        const relayPoints: TacticalPoint[] = [];
        const relayIds: string[] = [];
        const existingRelayCount = pointsRef.current.filter((p) => p.type === 'relais').length;

        for (let i = 0; i < minRelays.length; i++) {
          const r = minRelays[i];
          const relayId = `point-${++idCounter}`;
          const relayName = `Relais ${existingRelayCount + i + 1}`;
          const relayPoint: TacticalPoint = {
            id: relayId,
            name: relayName,
            type: 'relais',
            lat: r.lat,
            lng: r.lng,
            antennaHeight: 10,
          };
          relayPoints.push(relayPoint);
          relayIds.push(relayId);
        }

        setPoints((prev) => [...prev, ...relayPoints]);
        toast({ title: `📍 ${relayPoints.length} relais placé(s)`, description: relayPoints.map((r) => r.name).join(', ') });

        // Step 4: Build segments by slicing the ORIGINAL profile at relay indices
        // This ensures consistency — same elevation data used for planning and verification
        const relayIndices = minRelays.map((r) => r.profileIndex);
        const chainIndices = [0, ...relayIndices, fullProfile.length - 1];
        const chainIds = [fromId, ...relayIds, toId];
        const chainHeights = [from.antennaHeight, ...relayPoints.map(() => 10), to.antennaHeight];

        const segmentResults: ViewshedResult[] = [];
        const allNewResults: ViewshedResult[] = [];

        for (let i = 0; i < chainIndices.length - 1; i++) {
          const startIdx = chainIndices[i];
          const endIdx = chainIndices[i + 1];
          // Slice the original profile and re-base distances from 0
          const sliced = fullProfile.slice(startIdx, endIdx + 1);
          const baseDistance = sliced[0].distance;
          const segProfile = sliced.map((p) => ({
            ...p,
            distance: p.distance - baseDistance,
          }));

          if (segProfile.length >= 2) {
            const segLos = calculateLineOfSight(segProfile, chainHeights[i], chainHeights[i + 1]);
            const segSuggestions = segLos.visible ? [] : suggestRelayPositions(segProfile, chainHeights[i], chainHeights[i + 1]);
            const segResult: ViewshedResult = {
              fromId: chainIds[i],
              toId: chainIds[i + 1],
              visible: segLos.visible,
              elevationProfile: segProfile,
              losLine: segLos.losLine,
              suggestions: segSuggestions,
            };
            segmentResults.push(segResult);
            allNewResults.push(segResult);
          }
        }

        // Clear suggestions from direct result since relays are now placed
        const resolvedDirect = { ...directResult, suggestions: [] };
        // Only keep segment results on the map (not the blocked direct line)
        setViewshedResults(allNewResults);
        const allVisible = segmentResults.every((s) => s.visible);

        setLinkAnalysis({
          sourceId: fromId, destId: toId,
          directResult: resolvedDirect,
          segmentResults,
          relayIds,
          complete: allVisible,
        });

        if (allVisible) {
          toast({ title: '✅ Liaison établie', description: `${relayIds.length} relais — tous les segments visibles` });
        } else {
          toast({ title: '⚠️ Partiellement résolu', description: 'Certains segments restent bloqués', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Erreur', description: "Échec de l'analyse.", variant: 'destructive' });
      }
      setIsAnalyzing(false);
    },
    [points]
  );

  const handleSuggestionClick = useCallback(
    async (lat: number, lng: number, _elevation: number, _fromId: string, _toId: string) => {
      const relayId = `point-${++idCounter}`;
      const relayName = `Relais ${points.filter((p) => p.type === 'relais').length + 1}`;
      const newRelay: TacticalPoint = {
        id: relayId,
        name: relayName,
        type: 'relais',
        lat,
        lng,
        antennaHeight: 10,
      };
      setPoints((prev) => [...prev, newRelay]);
      toast({ title: 'Relais placé', description: `${relayName} ajouté.` });
    },
    [points]
  );

  const handleCenterOnPoint = useCallback((point: TacticalPoint) => {
    setCenterOn([point.lat, point.lng]);
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
        onClearViewshed={() => {
          setViewshedResults([]);
          setLinkAnalysis(null);
        }}
        onCenterOnPoint={handleCenterOnPoint}
        isAnalyzing={isAnalyzing}
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
