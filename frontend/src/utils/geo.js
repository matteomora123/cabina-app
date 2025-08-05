// utils/geo.js

/**
 * Converte un punto (px, py) della crop in [lat, lng] usando la proiezione Web Mercator.
 */
export function pixelToLatLng(
  px,
  py,
  centerLat,
  centerLng,
  zoom,
  cropSize = 300
) {
  centerLat = parseFloat(centerLat);
  centerLng = parseFloat(centerLng);
  zoom = parseInt(zoom);
  cropSize = parseInt(cropSize);

  const tileSize = 256;
  const worldSize = tileSize * Math.pow(2, zoom);

  // Helpers
  function latLngToGlobalPx(lat, lng) {
    const x = (lng + 180.0) / 360.0 * worldSize;
    const sinLat = Math.sin(lat * Math.PI / 180);
    const y =
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
    return [x, y];
  }
  function globalPxToLatLng(x, y) {
    const lng = (x / worldSize) * 360.0 - 180.0;
    const n = Math.PI - (2.0 * Math.PI * y) / worldSize;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return [lat, lng];
  }

  // Centro crop in pixel globali
  const [centerX, centerY] = latLngToGlobalPx(centerLat, centerLng);
  // Offset locali
  const dx = px - cropSize / 2;
  const dy = py - cropSize / 2;
  // Nuova posizione in pixel globali
  const pointX = centerX + dx;
  const pointY = centerY + dy;
  // Conversione inversa
  return globalPxToLatLng(pointX, pointY);
}

/**
 * Converte i poligoni (in pixel relativi alla crop) in [lat,lng]
 * usando i parametri dello scatto. Non richiede l'oggetto mappa.
 */
export function convertPolygonData(polygons = [], captureParams = {}) {
  const cropSize = parseInt(captureParams.crop_width ?? 300, 10);
  const zoom = parseInt(captureParams.zoom, 10);
  const centerLat = parseFloat(captureParams.centerLat);
  const centerLng = parseFloat(captureParams.centerLng);

  return polygons.map((poly) => ({
    ...poly,
    points: (poly.points || []).map(([x, y]) =>
      pixelToLatLng(x, y, centerLat, centerLng, zoom, cropSize)
    ),
  }));
}
