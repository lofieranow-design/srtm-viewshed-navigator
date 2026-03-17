/**
 * Elevation grid data sources:
 * 1. GeoTIFF file (local upload)
 * 2. Open-Elevation API (online fallback)
 */

import { ElevationGrid } from './contours';

const OPEN_ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';

/**
 * Fetch an elevation grid from Open-Elevation API for a bounding box.
 */
export async function fetchElevationGrid(
  bounds: { north: number; south: number; east: number; west: number },
  resolution: number = 50
): Promise<ElevationGrid> {
  const locations: { latitude: number; longitude: number }[] = [];

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const lat = bounds.north - (r / (resolution - 1)) * (bounds.north - bounds.south);
      const lng = bounds.west + (c / (resolution - 1)) * (bounds.east - bounds.west);
      locations.push({ latitude: lat, longitude: lng });
    }
  }

  // Open-Elevation has a limit, so batch requests
  const batchSize = 200;
  const allResults: number[] = [];

  for (let i = 0; i < locations.length; i += batchSize) {
    const batch = locations.slice(i, i + batchSize);
    const res = await fetch(OPEN_ELEVATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: batch }),
    });
    const data = await res.json();
    allResults.push(...data.results.map((r: any) => r.elevation as number));
  }

  // Reshape into 2D grid
  const grid: number[][] = [];
  for (let r = 0; r < resolution; r++) {
    grid.push(allResults.slice(r * resolution, (r + 1) * resolution));
  }

  return {
    data: grid,
    bounds,
    rows: resolution,
    cols: resolution,
  };
}

/**
 * Parse a GeoTIFF file into an ElevationGrid.
 */
export async function parseGeoTIFF(file: File): Promise<ElevationGrid> {
  const { fromBlob } = await import('geotiff');
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();

  const rasters = await image.readRasters();
  const data = rasters[0] as Float32Array | Float64Array | Int16Array | Uint16Array;
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox(); // [west, south, east, north]

  // Get nodata value
  const fileDir = image.getFileDirectory() as Record<string, any>;
  const noDataValue = fileDir['GDAL_NODATA'] ? parseFloat(String(fileDir['GDAL_NODATA'])) : undefined;

  // Reshape into 2D grid
  const grid: number[][] = [];
  for (let r = 0; r < height; r++) {
    const row: number[] = [];
    for (let c = 0; c < width; c++) {
      row.push(data[r * width + c]);
    }
    grid.push(row);
  }

  return {
    data: grid,
    bounds: {
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
    },
    rows: height,
    cols: width,
    noDataValue,
  };
}
