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

  const relayAntennaHeight = 10;

  // For each candidate point, check if it has LOS to BOTH endpoints
  const candidates: { index: number; score: number }[] = [];

  for (let i = 2; i < profile.length - 2; i++) {
    const seesFrom = checkVisibility(profile, 0, i, antennaHeight1, relayAntennaHeight);
    const seesTo = checkVisibility(profile, i, profile.length - 1, relayAntennaHeight, antennaHeight2);

    if (seesFrom && seesTo) {
      const centrality = 1 - Math.abs(2 * i / profile.length - 1);
      const score = profile[i].elevation + centrality * 100;
      candidates.push({ index: i, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

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
      lat: p.lat, lng: p.lng, elevation: p.elevation, distance: p.distance,
      reason: `Altitude ${p.elevation.toFixed(0)}m — visibilité directe vers les 2 extrémités ✅`,
    });
    usedIndices.add(c.index);
  }

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
        lat: p.lat, lng: p.lng, elevation: p.elevation, distance: p.distance,
        reason: `Point le plus élevé (${p.elevation.toFixed(0)}m) — ${seesFrom ? '✅ voit source' : '❌ ne voit pas source'}, ${seesTo ? '✅ voit destination' : '❌ ne voit pas destination'}`,
      });
    }
  }

  return suggestions;
}

/**
 * Greedy forward-scan: finds the minimum set of relay positions needed
 * to establish a chain of LOS segments from start to end.
 * 
 * Algorithm:
 * 1. From current position, scan forward to find the farthest point with LOS
 * 2. If it reaches the destination → segment complete
 * 3. If not, find the best relay candidate between current and first obstacle
 *    that can see the farthest forward
 * 4. Place relay there, repeat from relay position
 */
export function findMinimalRelays(
  profile: { distance: number; elevation: number; lat: number; lng: number }[],
  antennaHeight1: number,
  antennaHeight2: number,
  maxRelays: number = 5
): { lat: number; lng: number; elevation: number; distance: number; profileIndex: number }[] {
  if (profile.length < 3) return [];

  const relayH = 10;
  const relays: { lat: number; lng: number; elevation: number; distance: number; profileIndex: number }[] = [];

  let currentIdx = 0;
  let currentH = antennaHeight1;

  while (currentIdx < profile.length - 1 && relays.length < maxRelays) {
    // Check if current position can see the destination
    const destH = relays.length === 0 ? antennaHeight2 : antennaHeight2; // dest always uses its own height
    if (checkVisibility(profile, currentIdx, profile.length - 1, currentH, antennaHeight2)) {
      break; // Can see destination — done!
    }

    // Find the farthest visible point from current position
    let farthestVisible = currentIdx + 1;
    for (let j = currentIdx + 2; j < profile.length; j++) {
      if (checkVisibility(profile, currentIdx, j, currentH, relayH)) {
        farthestVisible = j;
      }
    }

    // Now find the best relay: among visible points from current,
    // pick the one that can see the farthest forward (greedy)
    let bestRelayIdx = -1;
    let bestForwardReach = -1;

    for (let candidate = currentIdx + 1; candidate <= farthestVisible; candidate++) {
      // This candidate must be visible from current
      if (!checkVisibility(profile, currentIdx, candidate, currentH, relayH)) continue;

      // How far forward can this candidate see?
      let forwardReach = candidate;
      if (checkVisibility(profile, candidate, profile.length - 1, relayH, antennaHeight2)) {
        forwardReach = profile.length - 1; // Can see destination!
      } else {
        for (let j = candidate + 1; j < profile.length; j++) {
          const h2 = j === profile.length - 1 ? antennaHeight2 : relayH;
          if (checkVisibility(profile, candidate, j, relayH, h2)) {
            forwardReach = j;
          }
        }
      }

      if (forwardReach > bestForwardReach) {
        bestForwardReach = forwardReach;
        bestRelayIdx = candidate;
      }
    }

    if (bestRelayIdx < 0 || bestRelayIdx === currentIdx) {
      // Can't progress — fallback: place at highest point ahead
      let highestIdx = currentIdx + 1;
      for (let j = currentIdx + 2; j < profile.length - 1; j++) {
        if (profile[j].elevation > profile[highestIdx].elevation) {
          highestIdx = j;
        }
      }
      bestRelayIdx = highestIdx;
    }

    const p = profile[bestRelayIdx];
    relays.push({
      lat: p.lat, lng: p.lng,
      elevation: p.elevation,
      distance: p.distance,
      profileIndex: bestRelayIdx,
    });

    currentIdx = bestRelayIdx;
    currentH = relayH;
  }

  return relays;
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
