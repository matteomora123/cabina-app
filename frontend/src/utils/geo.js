import { area as turfArea } from '@turf/turf';

/**
 * Ruota un punto [x,y] attorno al centro della crop di un certo angolo in gradi.
 */
function rotateAroundCenter([x, y], angleDeg, cropSize = 300) {
  const rad = (angleDeg * Math.PI) / 180;
  const cx = cropSize / 2, cy = cropSize / 2;
  const dx = x - cx, dy = y - cy;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return [cx + rx, cy + ry];
}

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
  zoom = parseFloat(zoom);
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
  const zoom = parseFloat(captureParams.zoom);
  const centerLat = parseFloat(captureParams.centerLat);
  const centerLng = parseFloat(captureParams.centerLng);
  const bearing = parseFloat(captureParams.bearing ?? 0);

  return polygons.map((poly) => {
    const latLngPoints = (poly.points || []).map(([x, y]) => {
      const [ux, uy] = bearing
        ? rotateAroundCenter([x, y], -bearing, cropSize)
        : [x, y];
      return pixelToLatLng(ux, uy, centerLat, centerLng, zoom, cropSize);
    });
    const mq =
      latLngPoints.length > 2
        ? Math.round(calculatePolygonArea(latLngPoints))
        : 0;
    return { ...poly, points: latLngPoints, mq };
  });
}

/**
 * Calcola l'area (in metri quadrati) di un poligono definito da una lista di punti [lat, lng].
 */
export function calculatePolygonArea(latlngPoints) {
  const coords = latlngPoints.map(([lat, lng]) => [lng, lat]);
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
