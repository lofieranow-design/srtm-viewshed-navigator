import { LinkAnalysis, TacticalPoint } from '@/types/tactical';
import { X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ElevationProfileProps {
  linkAnalysis: LinkAnalysis | null;
  points: TacticalPoint[];
  onClose: () => void;
  hoveredLinePoint?: { lat: number; lng: number; distance: number } | null;
}

function ProfileChart({
  label,
  profile,
  losLine,
  visible,
  suggestions,
  relayMarkers,
  hoveredDistance,
}: {
  label: string;
  profile: { distance: number; elevation: number }[];
  losLine: { distance: number; elevation: number }[];
  visible: boolean;
  suggestions?: { distance: number; elevation: number }[];
  relayMarkers?: { distance: number; elevation: number; name: string }[];
  hoveredDistance?: number | null;
}) {
  if (profile.length === 0) return null;

  const maxElev = Math.max(...profile.map((p) => p.elevation), ...losLine.map((p) => p.elevation));
  const minElev = Math.min(...profile.map((p) => p.elevation));
  const maxDist = profile[profile.length - 1]?.distance || 1;
  const padding = (maxElev - minElev) * 0.15 || 20;

  const chartH = 120;
  const chartW = 400;

  const toX = (d: number) => (d / maxDist) * chartW;
  const toY = (e: number) => chartH - ((e - minElev + padding) / (maxElev - minElev + padding * 2)) * chartH;

  const terrainPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`)
    .join(' ');
  const terrainFill = `${terrainPath} L${toX(maxDist).toFixed(1)},${chartH} L0,${chartH} Z`;
  const losPath = losLine
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`)
    .join(' ');

  // Compute obstacle zones (terrain above LOS)
  const obstacleZones: string[] = [];
  if (!visible) {
    let inObstacle = false;
    let zonePath = '';
    for (let i = 0; i < profile.length; i++) {
      const t = maxDist > 0 ? profile[i].distance / maxDist : 0;
      const losElev = losLine[0]?.elevation + t * ((losLine[losLine.length - 1]?.elevation || 0) - (losLine[0]?.elevation || 0));
      if (profile[i].elevation > losElev) {
        if (!inObstacle) {
          zonePath = `M${toX(profile[i].distance).toFixed(1)},${toY(losElev).toFixed(1)}`;
          inObstacle = true;
        }
        zonePath += ` L${toX(profile[i].distance).toFixed(1)},${toY(profile[i].elevation).toFixed(1)}`;
      } else if (inObstacle) {
        zonePath += ` L${toX(profile[i].distance).toFixed(1)},${toY(losElev).toFixed(1)} Z`;
        obstacleZones.push(zonePath);
        inObstacle = false;
      }
    }
    if (inObstacle) {
      const lastDist = profile[profile.length - 1].distance;
      const losElev = losLine[losLine.length - 1]?.elevation || 0;
      zonePath += ` L${toX(lastDist).toFixed(1)},${toY(losElev).toFixed(1)} Z`;
      obstacleZones.push(zonePath);
    }
  }

  // Find hovered point elevation
  let hoveredElev: number | null = null;
  let hoveredX: number | null = null;
  if (hoveredDistance != null && hoveredDistance >= 0 && hoveredDistance <= maxDist) {
    hoveredX = toX(hoveredDistance);
    // Interpolate elevation from profile
    for (let i = 0; i < profile.length - 1; i++) {
      if (hoveredDistance >= profile[i].distance && hoveredDistance <= profile[i + 1].distance) {
        const t = (hoveredDistance - profile[i].distance) / (profile[i + 1].distance - profile[i].distance);
        hoveredElev = profile[i].elevation + t * (profile[i + 1].elevation - profile[i].elevation);
        break;
      }
    }
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold ${visible ? 'text-accent' : 'text-destructive'}`}>
          {visible ? '✅' : '❌'}
        </span>
        <span className="text-xs font-medium text-foreground truncate">{label}</span>
      </div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-[120px]">
        <path d={terrainFill} fill="hsl(142, 71%, 45%)" opacity={0.15} />
        <path d={terrainPath} fill="none" stroke="hsl(142, 71%, 45%)" strokeWidth="1.5" />
        {obstacleZones.map((z, i) => (
          <path key={`obs-${i}`} d={z} fill="hsl(0, 84%, 60%)" opacity={0.25} />
        ))}
        <path
          d={losPath}
          fill="none"
          stroke={visible ? 'hsl(217, 91%, 60%)' : 'hsl(0, 84%, 60%)'}
          strokeWidth="1.5"
          strokeDasharray={visible ? '' : '5 3'}
        />
        {suggestions?.map((s, i) => {
          const sx = toX(s.distance);
          const sy = toY(s.elevation);
          return (
            <g key={`sug-${i}`}>
              <line x1={sx} y1={sy} x2={sx} y2={chartH} stroke="hsl(37, 91%, 55%)" strokeWidth="1" strokeDasharray="3 2" />
              <polygon points={`${sx},${sy - 6} ${sx - 4},${sy} ${sx + 4},${sy}`} fill="hsl(37, 91%, 55%)" />
              <text x={sx} y={sy - 9} textAnchor="middle" fill="hsl(37, 91%, 55%)" fontSize="7" fontWeight="bold">R{i + 1}</text>
            </g>
          );
        })}
        {relayMarkers?.map((r, i) => {
          const rx = toX(r.distance);
          const ry = toY(r.elevation);
          return (
            <g key={`relay-${i}`}>
              <line x1={rx} y1={ry} x2={rx} y2={chartH} stroke="hsl(37, 91%, 55%)" strokeWidth="1.5" />
              <polygon points={`${rx - 5},${ry} ${rx},${ry - 8} ${rx + 5},${ry}`} fill="hsl(37, 91%, 55%)" stroke="white" strokeWidth="1" />
              <text x={rx} y={ry - 11} textAnchor="middle" fill="hsl(37, 91%, 55%)" fontSize="7" fontWeight="bold">{r.name}</text>
            </g>
          );
        })}
        {/* Hover indicator */}
        {hoveredX != null && hoveredElev != null && (
          <g>
            <line x1={hoveredX} y1={0} x2={hoveredX} y2={chartH} stroke="hsl(0, 0%, 100%)" strokeWidth="1" strokeDasharray="3 2" opacity={0.8} />
            <circle cx={hoveredX} cy={toY(hoveredElev)} r="4" fill="hsl(45, 100%, 60%)" stroke="white" strokeWidth="1.5" />
            <text x={hoveredX} y={toY(hoveredElev) - 8} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
              {hoveredElev.toFixed(0)}m
            </text>
          </g>
        )}
        {/* Start/End markers */}
        <circle cx={toX(0)} cy={toY(profile[0].elevation)} r="3.5" fill="hsl(217, 91%, 60%)" />
        <circle cx={toX(maxDist)} cy={toY(profile[profile.length - 1].elevation)} r="3.5" fill="hsl(217, 91%, 60%)" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
        <span>0 m</span>
        <span>Min: {minElev.toFixed(0)}m — Max: {maxElev.toFixed(0)}m</span>
        <span>{(maxDist / 1000).toFixed(1)} km</span>
      </div>
    </div>
  );
}

export default function ElevationProfile({ linkAnalysis, points, onClose, hoveredLinePoint }: ElevationProfileProps) {
  if (!linkAnalysis) return null;

  const { directResult, segmentResults, relayIds, complete } = linkAnalysis;
  const source = points.find((p) => p.id === linkAnalysis.sourceId);
  const dest = points.find((p) => p.id === linkAnalysis.destId);

  if (directResult.elevationProfile.length === 0) return null;

  // Build combined multi-hop profile
  let combinedProfile: { distance: number; elevation: number }[] = [];
  let combinedLos: { distance: number; elevation: number }[] = [];
  const relayMarkers: { distance: number; elevation: number; name: string }[] = [];
  let distOffset = 0;

  if (segmentResults.length > 0) {
    segmentResults.forEach((seg, idx) => {
      const segProfile = seg.elevationProfile;
      if (segProfile.length === 0) return;
      const startIdx = idx === 0 ? 0 : 1;
      for (let i = startIdx; i < segProfile.length; i++) {
        combinedProfile.push({
          distance: segProfile[i].distance + distOffset,
          elevation: segProfile[i].elevation,
        });
      }
      for (let i = startIdx; i < seg.losLine.length; i++) {
        combinedLos.push({
          distance: seg.losLine[i].distance + distOffset,
          elevation: seg.losLine[i].elevation,
        });
      }
      if (idx < segmentResults.length - 1) {
        const lastPt = segProfile[segProfile.length - 1];
        const relayPoint = points.find((p) => p.id === relayIds[idx]);
        relayMarkers.push({
          distance: lastPt.distance + distOffset,
          elevation: lastPt.elevation,
          name: relayPoint?.name || `R${idx + 1}`,
        });
      }
      distOffset += segProfile[segProfile.length - 1].distance;
    });
  }

  const hasMultiHop = segmentResults.length > 0;
  const allSegmentsVisible = segmentResults.every((s) => s.visible);

  // Compute hovered distance for chart
  const hoveredDist = hoveredLinePoint?.distance ?? null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border p-3 shadow-lg z-[1000]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">
          Analyse: {source?.name} → {dest?.name}
          {complete && <span className="ml-2 text-xs font-normal text-accent">✅ Liaison établie via relais</span>}
          {!complete && hasMultiHop && <span className="ml-2 text-xs font-normal text-destructive">⏳ Analyse en cours...</span>}
        </h3>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <ProfileChart
          label={`Liaison directe — ${source?.name} → ${dest?.name}`}
          profile={directResult.elevationProfile}
          losLine={directResult.losLine}
          visible={directResult.visible}
          suggestions={directResult.visible ? undefined : directResult.suggestions}
          hoveredDistance={hoveredDist}
        />

        {hasMultiHop && (
          <div className="flex flex-col items-center gap-1 px-2">
            <ArrowRight className="h-6 w-6 text-primary" />
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              {relayIds.length} relais
            </span>
          </div>
        )}

        {hasMultiHop && combinedProfile.length > 0 && (
          <ProfileChart
            label={`Via relais — ${[source?.name, ...relayIds.map((id) => points.find((p) => p.id === id)?.name || '?'), dest?.name].join(' → ')}`}
            profile={combinedProfile}
            losLine={combinedLos}
            visible={allSegmentsVisible}
            relayMarkers={relayMarkers}
          />
        )}
      </div>
    </div>
  );
}
