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
  profile: { distance: number; elevation: number }[],
  antennaHeight1: number,
  antennaHeight2: number
): { visible: boolean; losLine: { distance: number; elevation: number }[] } {
  if (profile.length < 2) return { visible: false, losLine: [] };

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
  for (let i = 1; i < profile.length - 1; i++) {
    const t = totalDist > 0 ? profile[i].distance / totalDist : 0;
    const losElev = startElev + t * (endElev - startElev);
    if (profile[i].elevation > losElev) {
      visible = false;
      break;
    }
  }

  return { visible, losLine };
}
