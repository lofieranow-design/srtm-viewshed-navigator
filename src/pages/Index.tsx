import { useState, useCallback, useRef } from 'react';
import { TacticalPoint, StationType, STATION_LABELS, ViewshedResult, LinkAnalysis } from '@/types/tactical';
import { getElevationProfile, calculateLineOfSight, suggestRelayPositions } from '@/lib/elevation';
import TacticalMap from '@/components/TacticalMap';
import Sidebar from '@/components/Sidebar';
import ElevationProfile from '@/components/ElevationProfile';
import { toast } from '@/hooks/use-toast';

let idCounter = 0;
const MAX_RELAY_DEPTH = 5;

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

  /** Analyze a single segment and return the result */
  const analyzeSegment = async (
    fromPt: { lat: number; lng: number; antennaHeight: number; id: string },
    toPt: { lat: number; lng: number; antennaHeight: number; id: string }
  ): Promise<ViewshedResult | null> => {
    const profile = await getElevationProfile(fromPt.lat, fromPt.lng, toPt.lat, toPt.lng, 50);
    if (profile.length === 0) return null;

    const { visible, losLine } = calculateLineOfSight(profile, fromPt.antennaHeight, toPt.antennaHeight);
    const suggestions = visible ? [] : suggestRelayPositions(profile, fromPt.antennaHeight, toPt.antennaHeight);

    return {
      fromId: fromPt.id,
      toId: toPt.id,
      visible,
      elevationProfile: profile,
      losLine,
      suggestions,
    };
  };

  /** Recursively resolve a segment by placing relays until visible or max depth */
  const resolveSegment = async (
    fromPt: TacticalPoint,
    toPt: TacticalPoint,
    depth: number,
    allNewPoints: TacticalPoint[],
    allResults: ViewshedResult[],
    allRelayIds: string[]
  ): Promise<void> => {
    const result = await analyzeSegment(fromPt, toPt);
    if (!result) {
      toast({ title: 'Erreur', description: `Impossible d'analyser ${fromPt.name} → ${toPt.name}`, variant: 'destructive' });
      return;
    }

    if (result.visible) {
      // Segment is clear
      allResults.push(result);
      setViewshedResults((prev) => [...prev, result]);
      toast({ title: '✅ Segment OK', description: `${fromPt.name} → ${toPt.name}` });
      return;
    }

    // Not visible — place the best relay suggestion
    if (depth >= MAX_RELAY_DEPTH || result.suggestions.length === 0) {
      // Can't resolve further, store result as-is
      allResults.push(result);
      setViewshedResults((prev) => [...prev, result]);
      toast({
        title: '❌ Impossible de résoudre',
        description: `${fromPt.name} → ${toPt.name} — profondeur max atteinte`,
        variant: 'destructive',
      });
      return;
    }

    // Pick the best suggestion (first one — already sorted by score)
    const bestSuggestion = result.suggestions[0];
    const relayId = `point-${++idCounter}`;
    const relayName = `Relais ${pointsRef.current.filter((p) => p.type === 'relais').length + allNewPoints.filter((p) => p.type === 'relais').length + 1}`;
    const relayPoint: TacticalPoint = {
      id: relayId,
      name: relayName,
      type: 'relais',
      lat: bestSuggestion.lat,
      lng: bestSuggestion.lng,
      antennaHeight: 10,
    };

    allNewPoints.push(relayPoint);
    allRelayIds.push(relayId);
    setPoints((prev) => [...prev, relayPoint]);
    toast({ title: '📍 Relais auto-placé', description: `${relayName} à ${bestSuggestion.elevation.toFixed(0)}m` });

    // Recursively resolve: from → relay, then relay → to
    await resolveSegment(fromPt, relayPoint, depth + 1, allNewPoints, allResults, allRelayIds);
    await resolveSegment(relayPoint, toPt, depth + 1, allNewPoints, allResults, allRelayIds);
  };

  const handleRunViewshed = useCallback(
    async (fromId: string, toId: string) => {
      const from = points.find((p) => p.id === fromId);
      const to = points.find((p) => p.id === toId);
      if (!from || !to) return;

      setIsAnalyzing(true);
      setViewshedResults([]);
      setLinkAnalysis(null);

      try {
        // Step 1: Direct analysis
        const directResult = await analyzeSegment(from, to);
        if (!directResult) {
          toast({ title: 'Erreur', description: "Impossible de récupérer les données d'élévation.", variant: 'destructive' });
          setIsAnalyzing(false);
          return;
        }

        if (directResult.visible) {
          // Direct link works!
          setViewshedResults([directResult]);
          setLinkAnalysis({
            sourceId: fromId,
            destId: toId,
            directResult,
            segmentResults: [directResult],
            relayIds: [],
            complete: true,
          });
          toast({ title: '✅ Liaison directe possible', description: `${from.name} → ${to.name}` });
          setIsAnalyzing(false);
          return;
        }

        // Step 2: Direct link blocked — auto-resolve with relays
        toast({ title: '❌ Obstacle détecté', description: `Recherche automatique de relais...` });

        const allNewPoints: TacticalPoint[] = [];
        const segmentResults: ViewshedResult[] = [];
        const relayIds: string[] = [];

        await resolveSegment(from, to, 0, allNewPoints, segmentResults, relayIds);

        const allVisible = segmentResults.every((r) => r.visible);
        setLinkAnalysis({
          sourceId: fromId,
          destId: toId,
          directResult,
          segmentResults,
          relayIds,
          complete: allVisible,
        });

        if (allVisible) {
          toast({ title: '✅ Liaison établie via relais', description: `${relayIds.length} relais placé(s)` });
        } else {
          toast({
            title: '⚠️ Liaison partiellement résolue',
            description: `Certains segments restent bloqués`,
            variant: 'destructive',
          });
        }
      } catch {
        toast({ title: 'Erreur', description: "Échec de l'analyse.", variant: 'destructive' });
      }
      setIsAnalyzing(false);
    },
    [points]
  );

  const handleSuggestionClick = useCallback(
    async (lat: number, lng: number, elevation: number, fromId: string, toId: string) => {
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
