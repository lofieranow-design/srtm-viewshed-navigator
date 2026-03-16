import { ViewshedResult, TacticalPoint } from '@/types/tactical';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ElevationProfileProps {
  result: ViewshedResult | null;
  points: TacticalPoint[];
  onClose: () => void;
}

export default function ElevationProfile({ result, points, onClose }: ElevationProfileProps) {
  if (!result || result.elevationProfile.length === 0) return null;

  const from = points.find((p) => p.id === result.fromId);
  const to = points.find((p) => p.id === result.toId);
  const profile = result.elevationProfile;
  const losLine = result.losLine;

  const maxElev = Math.max(...profile.map((p) => p.elevation), ...losLine.map((p) => p.elevation));
  const minElev = Math.min(...profile.map((p) => p.elevation));
  const maxDist = profile[profile.length - 1]?.distance || 1;
  const padding = (maxElev - minElev) * 0.15;

  const chartH = 140;
  const chartW = 500;

  const toX = (d: number) => (d / maxDist) * chartW;
  const toY = (e: number) => chartH - ((e - minElev + padding) / (maxElev - minElev + padding * 2)) * chartH;

  const terrainPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`)
    .join(' ');

  const terrainFill = `${terrainPath} L${toX(maxDist).toFixed(1)},${chartH} L0,${chartH} Z`;

  const losPath = losLine
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`)
    .join(' ');

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border p-4 shadow-lg z-[1000]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">
          Profil d'élévation: {from?.name} → {to?.name}
          <span className={`ml-2 text-xs font-normal ${result.visible ? 'text-accent' : 'text-destructive'}`}>
            {result.visible ? '✅ Visible' : '❌ Obstacle'}
          </span>
        </h3>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-[140px]">
        {/* Terrain fill */}
        <path d={terrainFill} fill="hsl(142, 71%, 45%)" opacity={0.2} />
        {/* Terrain line */}
        <path d={terrainPath} fill="none" stroke="hsl(142, 71%, 45%)" strokeWidth="2" />
        {/* LOS line */}
        <path
          d={losPath}
          fill="none"
          stroke={result.visible ? 'hsl(217, 91%, 60%)' : 'hsl(0, 84%, 60%)'}
          strokeWidth="1.5"
          strokeDasharray={result.visible ? '' : '5 3'}
        />
        {/* Start/End markers */}
        <circle cx={toX(0)} cy={toY(profile[0].elevation)} r="4" fill="hsl(217, 91%, 60%)" />
        <circle
          cx={toX(maxDist)}
          cy={toY(profile[profile.length - 1].elevation)}
          r="4"
          fill="hsl(217, 91%, 60%)"
        />
      </svg>

      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>0 m</span>
        <span>
          Min: {minElev.toFixed(0)}m — Max: {maxElev.toFixed(0)}m
        </span>
        <span>{(maxDist / 1000).toFixed(1)} km</span>
      </div>
    </div>
  );
}
