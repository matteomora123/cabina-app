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
    image: Optional[str] = None  # base64 invisibile catturata dal frontend
    lat: Optional[float] = None  # opzionale: lat iniziale
    lng: Optional[float] = None  # opzionale: lng iniziale

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

def pixel_to_latlng(px, py, centerLat, centerLng, zoom, crop_size=300, zoom_ref=19):
    earth_circumference = 40075016.686
    meters_per_pixel = (
        (earth_circumference * math.cos(math.radians(centerLat))) / (2 ** (zoom + 8))
    )
    scale = 2 ** (zoom_ref - zoom)
    cx = crop_size / 2
    cy = crop_size / 2
    dx = (px - cx) * scale
    dy = (py - cy) * scale
    delta_lat = -dy * meters_per_pixel / 110540
    delta_lng = dx * meters_per_pixel / (111320 * math.cos(math.radians(centerLat)))
    lat = centerLat + delta_lat
    lng = centerLng + delta_lng
    return lat, lng

def distance_to_crop_center(px, py, crop_size=300):
    cx = crop_size / 2
    cy = crop_size / 2
    return math.sqrt((px - cx) ** 2 + (py - cy) ** 2)

# ---- Funzione principale
async def ottimizza_coordinata(req: CoordinateOptimizationRequest) -> CoordinateOptimizationResponse:
    try:
        print("\n=== Avvio ottimizzazione coordinata ===")
        print(f"CHK: {req.chk}, Zoom: {req.zoom}, Crop: {req.crop_size}")
        print(f"Lat iniziale: {req.lat}, Lng iniziale: {req.lng}")

        # 1. Validazione immagine
        if not req.image or len(req.image) < 50:
            print("Immagine non valida (vuota o troppo corta)")
            raise HTTPException(status_code=400, detail="Immagine base64 mancante o troppo corta")

        # 2. Coordinate iniziali
        if req.lat is not None and req.lng is not None:
            lat, lng = req.lat, req.lng
        else:
            print("📡 Recupero coordinate iniziali dal backend...")
            async with httpx.AsyncClient() as client:
                res = await client.get(f"http://localhost:8000/cabina/{req.chk}")
                if res.status_code != 200:
                    raise HTTPException(status_code=404, detail="Cabina non trovata")
                data = res.json()
                lat, lng = data["lat"], data["lng"]
        print(f"Coordinate iniziali: lat={lat}, lng={lng}")

        zoom = req.zoom
        crop_size = req.crop_size

        # 3. Chiamata al microservizio AI
        print("Invio immagine e coordinate a /segmenta_ai...")
        async with httpx.AsyncClient() as client:
            payload = {
                "image": req.image,
                "lat": lat,
                "lng": lng,
                "zoom": zoom,
                "crop_width": crop_size,
                "crop_height": crop_size,
            }
            seg_res = await client.post("http://localhost:9000/segmenta_ai", json=payload)
            print(f"Risposta AI status: {seg_res.status_code}")
            seg_data = seg_res.json()
            poligoni = seg_data.get("poligoni", [])
            print(f"Poligoni ricevuti: {len(poligoni)}")

        # 4. Filtra solo poligoni "Stalli AT"
        stalli_at = [p for p in poligoni if p["label"] == "Stalli AT" and len(p["points"]) >= 3]
        print(f"Poligoni Stalli AT trovati: {len(stalli_at)}")
        if not stalli_at:
            print("Nessun poligono 'Stalli AT' trovato, ritorno coordinate originali")
            return CoordinateOptimizationResponse(
                new_lat=lat,
                new_lng=lng,
                iterations=1,
                final_distance_px=0,
                density_score=0,
                message="Nessun poligono 'Stalli AT' trovato"
            )

        # 5. Trova il poligono più grande (per area)
        shapely_stalli = [Polygon(p["points"]) for p in stalli_at]
        aree = [poly.area for poly in shapely_stalli]
        idx_max = aree.index(max(aree))
        poligono_max = shapely_stalli[idx_max]
        print(f"Selezionato poligono più grande, area: {poligono_max.area}")

        # 6. Centroide del poligono più grande
        centro = poligono_max.centroid
        print(f"Centroide pixel coords: x={centro.x}, y={centro.y}")

        # 7. Coordinate lat/lng dal centroide
        centro_lat, centro_lng = pixel_to_latlng(centro.x, centro.y, lat, lng, zoom, crop_size)
        print(f"Nuove coordinate calcolate: lat={centro_lat}, lng={centro_lng}")

        # 8. Calcola distanza dal centro crop (in pixel)
        px, py = latlng_to_pixel(centro_lat, centro_lng, lat, lng, zoom, crop_size)
        dist = distance_to_crop_center(px, py, crop_size)
        print(f"Distanza dal centro crop: {dist:.2f} px")

        # 9. Densità pixel (numero di vertici del poligono)
        density_prev = len(stalli_at[idx_max]["points"])
        print(f"Density score: {density_prev}")

        print("=== Ottimizzazione completata ===\n")
        return CoordinateOptimizationResponse(
            new_lat=centro_lat,
            new_lng=centro_lng,
            iterations=1,
            final_distance_px=dist,
            density_score=density_prev,
            message="Ottimizzazione basata sullo 'Stalli AT' più grande"
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Errore durante ottimizzazione: {e}")
        raise HTTPException(status_code=500, detail=f"Errore durante ottimizzazione: {str(e)}")



