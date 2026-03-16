// Uses Open-Elevation API to get elevation data
const OPEN_ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';

export async function getElevation(lat: number, lng: number): Promise<number> {
  try {
    const res = await fetch(OPEN_ELEVATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [{ latitude: lat, longitude: lng }] }),
    });
    const data = await res.json();
    return data.results[0].elevation;
  } catch {
    return 0;
  }
}

export async function getElevationProfile(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  samples: number = 50
): Promise<{ distance: number; elevation: number; lat: number; lng: number }[]> {
  const locations = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    locations.push({
      latitude: lat1 + t * (lat2 - lat1),
      longitude: lng1 + t * (lng2 - lng1),
    });
  }

  try {
    const res = await fetch(OPEN_ELEVATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
    });
    const data = await res.json();

    return data.results.map((r: any, i: number) => {
      const t = i / samples;
      const dlat = (lat2 - lat1) * t;
      const dlng = (lng2 - lng1) * t;
      const distance = Math.sqrt(
        (dlat * 111320) ** 2 + (dlng * 111320 * Math.cos((lat1 * Math.PI) / 180)) ** 2
      );
      return {
        distance: Math.round(distance),
        elevation: r.elevation,
        lat: r.latitude,
        lng: r.longitude,
      };
    });
  } catch {
    return [];
  }
}

export function calculateLineOfSight(
  profile: { distance: number; elevation: number; lat: number; lng: number }[],
  antennaHeight1: number,
  antennaHeight2: number
): { visible: boolean; losLine: { distance: number; elevation: number }[]; obstaclePeaks: { index: number; clearance: number }[] } {
  if (profile.length < 2) return { visible: false, losLine: [], obstaclePeaks: [] };

  const startElev = profile[0].elevation + antennaHeight1;
  const endElev = profile[profile.length - 1].elevation + antennaHeight2;
  const totalDist = profile[profile.length - 1].distance;

  const losLine = profile.map((p) => {
    const t = totalDist > 0 ? p.distance / totalDist : 0;
    return {
      distance: p.distance,
      elevation: startElev + t * (endElev - startElev),
    };
  });

  let visible = true;
  const obstaclePeaks: { index: number; clearance: number }[] = [];

  for (let i = 1; i < profile.length - 1; i++) {
    const t = totalDist > 0 ? profile[i].distance / totalDist : 0;
    const losElev = startElev + t * (endElev - startElev);
    const clearance = profile[i].elevation - losElev;
    if (clearance > 0) {
      visible = false;
      // Check if this is a local peak (higher than neighbors)
      const prevElev = profile[i - 1].elevation;
      const nextElev = profile[i + 1]?.elevation ?? 0;
      if (profile[i].elevation >= prevElev && profile[i].elevation >= nextElev) {
        obstaclePeaks.push({ index: i, clearance });
      }
    }
  }

  // Deduplicate: keep only the highest peak per obstacle cluster
  const filteredPeaks = obstaclePeaks
    .sort((a, b) => b.clearance - a.clearance)
    .slice(0, 3);

  return { visible, losLine, obstaclePeaks: filteredPeaks };
}

export function suggestRelayPositions(
  profile: { distance: number; elevation: number; lat: number; lng: number }[],
  antennaHeight1: number,
  antennaHeight2: number
): { lat: number; lng: number; elevation: number; distance: number; reason: string }[] {
  if (profile.length < 3) return [];

  const relayAntennaHeight = 10; // assumed relay antenna height

  // For each candidate point, check if it has LOS to BOTH endpoints
  const candidates: { index: number; score: number; seesFrom: boolean; seesTo: boolean }[] = [];

  for (let i = 2; i < profile.length - 2; i++) {
    const seesFrom = checkVisibility(profile, 0, i, antennaHeight1, relayAntennaHeight);
    const seesTo = checkVisibility(profile, i, profile.length - 1, relayAntennaHeight, antennaHeight2);

    if (seesFrom && seesTo) {
      // Score: prefer higher elevation + more central position
      const centrality = 1 - Math.abs(2 * i / profile.length - 1);
      const score = profile[i].elevation + centrality * 100;
      candidates.push({ index: i, score, seesFrom, seesTo });
    }
  }

  // Sort by score (best first)
  candidates.sort((a, b) => b.score - a.score);

  // Deduplicate: skip candidates too close to already selected ones
  const suggestions: { lat: number; lng: number; elevation: number; distance: number; reason: string }[] = [];
  const usedIndices = new Set<number>();

  for (const c of candidates) {
    if (suggestions.length >= 3) break;
    let tooClose = false;
    for (const used of usedIndices) {
      if (Math.abs(c.index - used) < 4) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const p = profile[c.index];
    suggestions.push({
      lat: p.lat,
      lng: p.lng,
      elevation: p.elevation,
      distance: p.distance,
      reason: `Altitude ${p.elevation.toFixed(0)}m — visibilité directe vers les 2 extrémités ✅`,
    });
    usedIndices.add(c.index);
  }

  // If no point sees both, find the best "sees one side" as fallback
  if (suggestions.length === 0) {
    let bestIdx = -1;
    let bestElev = -Infinity;
    for (let i = 2; i < profile.length - 2; i++) {
      if (profile[i].elevation > bestElev) {
        bestElev = profile[i].elevation;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const p = profile[bestIdx];
      const seesFrom = checkVisibility(profile, 0, bestIdx, antennaHeight1, relayAntennaHeight);
      const seesTo = checkVisibility(profile, bestIdx, profile.length - 1, relayAntennaHeight, antennaHeight2);
      suggestions.push({
        lat: p.lat,
        lng: p.lng,
        elevation: p.elevation,
        distance: p.distance,
        reason: `Point le plus élevé (${p.elevation.toFixed(0)}m) — ${seesFrom ? '✅ voit source' : '❌ ne voit pas source'}, ${seesTo ? '✅ voit destination' : '❌ ne voit pas destination'}`,
      });
    }
  }

  return suggestions;
}

function checkVisibility(
  profile: { distance: number; elevation: number }[],
  fromIdx: number,
  toIdx: number,
  h1: number,
  h2: number
): boolean {
  const startElev = profile[fromIdx].elevation + h1;
  const endElev = profile[toIdx].elevation + h2;
  const startDist = profile[fromIdx].distance;
  const endDist = profile[toIdx].distance;
  const totalDist = endDist - startDist;
  if (totalDist <= 0) return true;

  for (let i = fromIdx + 1; i < toIdx; i++) {
    const t = (profile[i].distance - startDist) / totalDist;
    const losElev = startElev + t * (endElev - startElev);
    if (profile[i].elevation > losElev) return false;
  }
  return true;
}
