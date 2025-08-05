# backend/armonizzazione/coord_optimizer.py

from fastapi import HTTPException
from pydantic import BaseModel
from typing import Optional
from shapely.geometry import Polygon
from shapely.ops import unary_union
import httpx
import math

# ---- Parametri configurabili
MAX_ITER = 5
CENTER_TOLERANCE_PX = 20
MIN_DENSITY_IMPROVEMENT = 10

# ---- Modelli dati
class CoordinateOptimizationRequest(BaseModel):
    chk: str
    zoom: Optional[int] = 18
    crop_size: Optional[int] = 300

class CoordinateOptimizationResponse(BaseModel):
    new_lat: float
    new_lng: float
    iterations: int
    final_distance_px: float
    density_score: int
    message: str

# ---- Funzioni di supporto
def latlng_to_pixel(lat, lng, centerLat, centerLng, zoom, crop_size=300, zoom_ref=19):
    earth_circumference = 40075016.686
    meters_per_pixel = (
        (earth_circumference * math.cos(math.radians(centerLat))) / (2 ** (zoom + 8))
    )
    scale = 2 ** (zoom_ref - zoom)
    delta_lat = lat - centerLat
    delta_lng = lng - centerLng

    dy = -delta_lat * 110540
    dx = delta_lng * 111320 * math.cos(math.radians(centerLat))
    px = crop_size / 2 + (dx / meters_per_pixel) / scale
    py = crop_size / 2 + (dy / meters_per_pixel) / scale
    return px, py

def distance_to_crop_center(px, py, crop_size=300):
    cx = crop_size / 2
    cy = crop_size / 2
    return math.sqrt((px - cx) ** 2 + (py - cy) ** 2)

# ---- Funzione principale
async def ottimizza_coordinata(req: CoordinateOptimizationRequest) -> CoordinateOptimizationResponse:
    try:
        async with httpx.AsyncClient() as client:
            # 1. Recupera coordinate iniziali della cabina
            res = await client.get(f"http://localhost:8000/cabina/{req.chk}")
            if res.status_code != 200:
                raise HTTPException(status_code=404, detail="Cabina non trovata")
            data = res.json()
            lat, lng = data["lat"], data["lng"]

            zoom = req.zoom
            crop_size = req.crop_size
            density_prev = 0

            for iterazione in range(1, MAX_ITER + 1):
                # 2. Chiamata AI per segmentazione
                payload = {
                    "image": "dummy",  # TODO: collegare cattura reale se disponibile
                    "lat": lat,
                    "lng": lng,
                    "zoom": zoom,
                    "crop_width": crop_size,
                    "crop_height": crop_size,
                }

                seg_res = await client.post("http://localhost:9000/segmenta_ai", json=payload)
                seg_data = seg_res.json()
                poligoni = seg_data.get("poligoni", [])

                # 3. Filtra poligoni rilevanti
                rilevanti = [p for p in poligoni if p["label"] in {"Locale AT/MT", "Stalli AT"}]
                if not rilevanti:
                    break

                # 4. Unione poligoni
                polygons = [Polygon(p["points"]) for p in rilevanti if len(p["points"]) >= 3]
                union = unary_union(polygons)
                centro = union.centroid
                centro_lat, centro_lng = centro.y, centro.x

                # 5. Calcola distanza dal centro crop
                px, py = latlng_to_pixel(centro_lat, centro_lng, lat, lng, zoom, crop_size)
                dist = distance_to_crop_center(px, py, crop_size)

                # 6. Controllo densità pixel
                pixel_count = sum(len(p["points"]) for p in rilevanti)
                delta_density = pixel_count - density_prev
                density_prev = pixel_count

                # 7. Condizioni di stop
                if dist < CENTER_TOLERANCE_PX or delta_density < MIN_DENSITY_IMPROVEMENT:
                    break

                # Aggiorna coordinate per iterazione successiva
                lat, lng = centro_lat, centro_lng

            return CoordinateOptimizationResponse(
                new_lat=lat,
                new_lng=lng,
                iterations=iterazione,
                final_distance_px=dist,
                density_score=density_prev,
                message="Coordinata ottimizzata con successo"
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante ottimizzazione: {str(e)}")
