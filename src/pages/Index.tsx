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
          suggestions = suggestRelayPositions(profile, 10);
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
