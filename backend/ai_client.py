# back end/ ai_client.py
import httpx
from schemas import AIRequest

async def call_ai_segmenta(image_b64: str, lat: float, lng: float, crop_width: int = None, crop_height: int = None, zoom: int = None):
    url = "http://localhost:9000/segmenta_ai"
    req = {
        "image": image_b64,
        "lat": lat,
        "lng": lng,
        "crop_width": crop_width,
        "crop_height": crop_height,
        "zoom": zoom,
    }
    # Elimina None prima di inviare
    req = {k: v for k, v in req.items() if v is not None}
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=req)
        return resp.json()
