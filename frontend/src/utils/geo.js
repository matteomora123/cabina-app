// geo.js
import { area as turfArea } from '@turf/turf';
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

  return polygons.map((poly) => {
    const latLngPoints = (poly.points || []).map(([x, y]) =>
      pixelToLatLng(x, y, centerLat, centerLng, zoom, cropSize)
    );
    // Calcolo area in mq
    const mq = latLngPoints.length > 2 ? Math.round(calculatePolygonArea(latLngPoints)) : 0;
    return {
      ...poly,
      points: latLngPoints,
      mq, // aggiungi qui
    };
  });
}
/**
 * Calcola l'area (in metri quadrati) di un poligono definito da una lista di punti [lat, lng].
 * @param {Array<Array<number>>} latlngPoints - Array di punti [[lat, lng], ...]
 * @returns {number} Area in metri quadrati (float)
 */
export function calculatePolygonArea(latlngPoints) {
  // Turf richiede GeoJSON con coordinate [lng, lat]
  const coords = latlngPoints.map(([lat, lng]) => [lng, lat]);
  // Chiudi il poligono se non già chiuso
  if (coords.length && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
    coords.push(coords[0]);
  }
  const polygonGeoJSON = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords]
    }
  };
  return turfArea(polygonGeoJSON);
}
