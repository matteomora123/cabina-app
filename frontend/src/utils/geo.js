// utils/geo.js

/**
 * Converte un punto (px, py) della crop in [lat, lng] usando solo
 * centro, zoom e dimensione crop catturati al momento dello scatto.
 */
export function pixelToLatLng(
  px,
  py,
  centerLat,
  centerLng,
  zoom,
  cropSize = 300,
  zoomRef = 19
) {
  centerLat = parseFloat(centerLat);
  centerLng = parseFloat(centerLng);
  zoom = parseInt(zoom);
  cropSize = parseInt(cropSize);
  zoomRef = parseInt(zoomRef);

  const earthCircumference = 40075016.686; // m
  const metersPerPixel =
    (earthCircumference * Math.cos((centerLat * Math.PI) / 180)) /
    Math.pow(2, zoom + 8);

  // se lo scatto è a zoom diverso da zoomRef, correggi la scala
  const scaleCorrection = Math.pow(2, zoomRef - zoom);

  const dx = (px - cropSize / 2) * scaleCorrection;
  const dy = (py - cropSize / 2) * scaleCorrection;

  const deltaLng =
    (dx * metersPerPixel) / (111320 * Math.cos((centerLat * Math.PI) / 180));
  const deltaLat = -(dy * metersPerPixel) / 110540;

  const lat = centerLat + deltaLat;
  const lng = centerLng + deltaLng;

  return [lat, lng];
}

/**
 * Converte i poligoni (in pixel relativi alla crop) in [lat,lng]
 * usando i parametri dello scatto. Non richiede l'oggetto mappa.
 */
export function convertPolygonData(polygons = [], captureParams = {}) {
  const cropSize = parseInt(captureParams.crop_width ?? 300, 10);
  const zoom = parseInt(captureParams.zoom, 10);
  const zoomRef = parseInt(captureParams.zoomRef ?? captureParams.zoom ?? 19, 10); // <—
  const centerLat = parseFloat(captureParams.centerLat);
  const centerLng = parseFloat(captureParams.centerLng);

  return polygons.map((poly) => ({
    ...poly,
    points: (poly.points || []).map(([x, y]) =>
      pixelToLatLng(x, y, centerLat, centerLng, zoom, cropSize, zoomRef)
    ),
  }));
}
