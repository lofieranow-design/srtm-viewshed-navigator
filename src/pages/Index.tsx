import { useState, useCallback } from 'react';
import { TacticalPoint, StationType, STATION_LABELS, ViewshedResult } from '@/types/tactical';
import { getElevationProfile, calculateLineOfSight } from '@/lib/elevation';
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
  const [selectedResult, setSelectedResult] = useState<ViewshedResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [centerOn, setCenterOn] = useState<[number, number] | null>(null);

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
  }, []);

  const handleUpdatePoint = useCallback((id: string, updates: Partial<TacticalPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const handlePointDrag = useCallback((id: string, lat: number, lng: number) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, lat, lng } : p)));
    // Clear viewshed results involving this point
    setViewshedResults((prev) => prev.filter((r) => r.fromId !== id && r.toId !== id));
  }, []);

  const handleRunViewshed = useCallback(
    async (fromId: string, toId: string) => {
      const from = points.find((p) => p.id === fromId);
      const to = points.find((p) => p.id === toId);
      if (!from || !to) return;

      setIsAnalyzing(true);
      try {
        const profile = await getElevationProfile(from.lat, from.lng, to.lat, to.lng, 50);

        if (profile.length === 0) {
          toast({
            title: 'Erreur',
            description: "Impossible de récupérer les données d'élévation. Réessayez.",
            variant: 'destructive',
          });
          setIsAnalyzing(false);
          return;
        }

        const { visible, losLine } = calculateLineOfSight(profile, from.antennaHeight, to.antennaHeight);

        // Generate relay suggestions if not visible
        let suggestions: import('@/types/tactical').RelaySuggestion[] = [];
        if (!visible) {
          const { suggestRelayPositions } = await import('@/lib/elevation');
          suggestions = suggestRelayPositions(profile, from.antennaHeight, to.antennaHeight);
        }

        const result: ViewshedResult = {
          fromId,
          toId,
          visible,
          elevationProfile: profile,
          losLine,
          suggestions,
        };

        setViewshedResults((prev) => {
          // Replace existing result for same pair
          const filtered = prev.filter((r) => !(r.fromId === fromId && r.toId === toId));
          return [...filtered, result];
        });
        setSelectedResult(result);

        toast({
          title: visible ? 'Liaison possible ✅' : 'Obstacle détecté ❌',
          description: visible
            ? `Visibilité directe entre ${from.name} et ${to.name}`
            : `Relief bloquant entre ${from.name} et ${to.name} — relais recommandé`,
        });
      } catch {
        toast({
          title: 'Erreur',
          description: "Échec de l'analyse de visibilité.",
          variant: 'destructive',
        });
      }
      setIsAnalyzing(false);
    },
    [points]
  );

  const handleCenterOnPoint = useCallback((point: TacticalPoint) => {
    setCenterOn([point.lat, point.lng]);
  }, []);

  const handleSuggestionClick = useCallback(
    async (lat: number, lng: number, elevation: number, fromId: string, toId: string) => {
      // 1. Place a relay point at the suggested location
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
      toast({ title: 'Relais placé', description: `${relayName} ajouté automatiquement.` });

      // 2. Clear old direct result for this pair
      setViewshedResults((prev) => prev.filter((r) => !(r.fromId === fromId && r.toId === toId)));
      setSelectedResult(null);

      // 3. Run two analyses: from → relay, relay → to
      const from = points.find((p) => p.id === fromId);
      const to = points.find((p) => p.id === toId);
      if (!from || !to) return;

      setIsAnalyzing(true);
      try {
        // Analysis 1: source → relay
        const profile1 = await getElevationProfile(from.lat, from.lng, lat, lng, 50);
        if (profile1.length > 0) {
          const los1 = calculateLineOfSight(profile1, from.antennaHeight, 10);
          let suggestions1: import('@/types/tactical').RelaySuggestion[] = [];
          if (!los1.visible) {
            const { suggestRelayPositions } = await import('@/lib/elevation');
            suggestions1 = suggestRelayPositions(profile1, from.antennaHeight, 10);
          }
          const result1: ViewshedResult = {
            fromId,
            toId: relayId,
            visible: los1.visible,
            elevationProfile: profile1,
            losLine: los1.losLine,
            suggestions: suggestions1,
          };
          setViewshedResults((prev) => [...prev, result1]);
          setSelectedResult(result1);
          toast({
            title: los1.visible ? '✅ Source → Relais OK' : '❌ Source → Relais bloqué',
            description: `${from.name} → ${relayName}`,
          });
        }

        // Analysis 2: relay → destination
        const profile2 = await getElevationProfile(lat, lng, to.lat, to.lng, 50);
        if (profile2.length > 0) {
          const los2 = calculateLineOfSight(profile2, 10, to.antennaHeight);
          let suggestions2: import('@/types/tactical').RelaySuggestion[] = [];
          if (!los2.visible) {
            const { suggestRelayPositions } = await import('@/lib/elevation');
            suggestions2 = suggestRelayPositions(profile2, 10, to.antennaHeight);
          }
          const result2: ViewshedResult = {
            fromId: relayId,
            toId,
            visible: los2.visible,
            elevationProfile: profile2,
            losLine: los2.losLine,
            suggestions: suggestions2,
          };
          setViewshedResults((prev) => [...prev, result2]);
          setSelectedResult(result2);
          toast({
            title: los2.visible ? '✅ Relais → Destination OK' : '❌ Relais → Destination bloqué',
            description: `${relayName} → ${to.name}`,
          });
        }
      } catch {
        toast({ title: 'Erreur', description: "Échec de l'analyse multi-saut.", variant: 'destructive' });
      }
      setIsAnalyzing(false);
    },
    [points]
  );

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
          setSelectedResult(null);
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
          result={selectedResult}
          points={points}
          onClose={() => setSelectedResult(null)}
        />
      </div>
    </div>
  );
}
