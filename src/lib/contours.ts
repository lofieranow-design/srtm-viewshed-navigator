/**
 * Marching Squares contour line generation algorithm.
 * Takes a 2D elevation grid and produces contour lines at specified intervals.
 */

export interface ContourLine {
  elevation: number;
  coordinates: [number, number][]; // [lng, lat] pairs (GeoJSON convention)
}

export interface ElevationGrid {
  data: number[][];       // [row][col] elevation values
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  rows: number;
  cols: number;
  noDataValue?: number;
}

/**
 * Generate contour lines from an elevation grid using marching squares.
 */
export function generateContours(grid: ElevationGrid, interval: number): ContourLine[] {
  const { data, bounds, rows, cols } = grid;
  const contours: ContourLine[] = [];

  // Determine elevation range
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = data[r][c];
      if (v !== grid.noDataValue && isFinite(v)) {
        minElev = Math.min(minElev, v);
        maxElev = Math.max(maxElev, v);
      }
    }
  }

  if (!isFinite(minElev) || !isFinite(maxElev)) return [];

  // Round to interval
  const startElev = Math.ceil(minElev / interval) * interval;
  const endElev = Math.floor(maxElev / interval) * interval;

  const cellWidth = (bounds.east - bounds.west) / (cols - 1);
  const cellHeight = (bounds.north - bounds.south) / (rows - 1);

  // For each contour level
  for (let level = startElev; level <= endElev; level += interval) {
    const segments = marchingSquares(data, rows, cols, level, grid.noDataValue);

    // Convert pixel coords to geographic coords and chain segments
    const chains = chainSegments(segments);

    for (const chain of chains) {
      const coordinates: [number, number][] = chain.map(([px, py]) => {
        const lng = bounds.west + px * cellWidth;
        const lat = bounds.north - py * cellHeight;
        return [lng, lat] as [number, number];
      });

      if (coordinates.length >= 2) {
        contours.push({ elevation: level, coordinates });
      }
    }
  }

  return contours;
}

/**
 * Marching squares: extract line segments for a single contour level.
 * Returns segments as pairs of [x, y] points in grid coordinates.
 */
function marchingSquares(
  data: number[][],
  rows: number,
  cols: number,
  level: number,
  noData?: number
): [number, number, number, number][] {
  const segments: [number, number, number, number][] = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = data[r][c];
      const tr = data[r][c + 1];
      const br = data[r + 1][c + 1];
      const bl = data[r + 1][c];

      // Skip cells with noData
      if (noData !== undefined) {
        if (tl === noData || tr === noData || br === noData || bl === noData) continue;
      }
      if (!isFinite(tl) || !isFinite(tr) || !isFinite(br) || !isFinite(bl)) continue;

      // Compute case index (4-bit)
      const caseIndex =
        (tl >= level ? 8 : 0) |
        (tr >= level ? 4 : 0) |
        (br >= level ? 2 : 0) |
        (bl >= level ? 1 : 0);

      if (caseIndex === 0 || caseIndex === 15) continue;

      // Interpolation helpers
      const lerp = (v1: number, v2: number) => {
        if (Math.abs(v2 - v1) < 1e-10) return 0.5;
        return (level - v1) / (v2 - v1);
      };

      // Edge midpoints (interpolated)
      const top: [number, number] = [c + lerp(tl, tr), r];
      const right: [number, number] = [c + 1, r + lerp(tr, br)];
      const bottom: [number, number] = [c + lerp(bl, br), r + 1];
      const left: [number, number] = [c, r + lerp(tl, bl)];

      // Lookup table for marching squares segments
      const addSeg = (p1: [number, number], p2: [number, number]) => {
        segments.push([p1[0], p1[1], p2[0], p2[1]]);
      };

      switch (caseIndex) {
        case 1: addSeg(left, bottom); break;
        case 2: addSeg(bottom, right); break;
        case 3: addSeg(left, right); break;
        case 4: addSeg(top, right); break;
        case 5: // Saddle point
          addSeg(left, top);
          addSeg(bottom, right);
          break;
        case 6: addSeg(top, bottom); break;
        case 7: addSeg(left, top); break;
        case 8: addSeg(top, left); break;
        case 9: addSeg(top, bottom); break;
        case 10: // Saddle point
          addSeg(top, right);
          addSeg(left, bottom);
          break;
        case 11: addSeg(top, right); break;
        case 12: addSeg(left, right); break;
        case 13: addSeg(bottom, right); break;
        case 14: addSeg(left, bottom); break;
      }
    }
  }

  return segments;
}

/**
 * Chain disconnected segments into polylines.
 */
function chainSegments(segments: [number, number, number, number][]): [number, number][][] {
  if (segments.length === 0) return [];

  const EPS = 1e-8;
  const match = (a: number, b: number) => Math.abs(a - b) < EPS;
  const ptMatch = (a: [number, number], b: [number, number]) => match(a[0], b[0]) && match(a[1], b[1]);

  // Convert segments to point pairs
  const available = segments.map((s) => ({
    p1: [s[0], s[1]] as [number, number],
    p2: [s[2], s[3]] as [number, number],
    used: false,
  }));

  const chains: [number, number][][] = [];

  for (let i = 0; i < available.length; i++) {
    if (available[i].used) continue;

    available[i].used = true;
    const chain: [number, number][] = [available[i].p1, available[i].p2];

    // Extend chain forward and backward
    let extended = true;
    while (extended) {
      extended = false;
      const head = chain[0];
      const tail = chain[chain.length - 1];

      for (let j = 0; j < available.length; j++) {
        if (available[j].used) continue;

        if (ptMatch(available[j].p1, tail)) {
          chain.push(available[j].p2);
          available[j].used = true;
          extended = true;
        } else if (ptMatch(available[j].p2, tail)) {
          chain.push(available[j].p1);
          available[j].used = true;
          extended = true;
        } else if (ptMatch(available[j].p2, head)) {
          chain.unshift(available[j].p1);
          available[j].used = true;
          extended = true;
        } else if (ptMatch(available[j].p1, head)) {
          chain.unshift(available[j].p2);
          available[j].used = true;
          extended = true;
        }
      }
    }

    chains.push(chain);
  }

  return chains;
}

/**
 * Convert contour lines to GeoJSON FeatureCollection.
 */
export function contoursToGeoJSON(contours: ContourLine[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: contours.map((c) => ({
      type: 'Feature' as const,
      properties: {
        elevation: c.elevation,
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: c.coordinates,
      },
    })),
  };
}
