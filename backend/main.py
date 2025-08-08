# backend/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from armonizzazione_single_cabin import router as armonizzazione_router
from schemas import AIRequest  #
from db import SessionLocal
import httpx

app = FastAPI()

# --- CABINE FAKE IN CASO DI DB OFFLINE ---
FAKE_CABINE = [
    {"id": 1, "id_cab": 47211, "denom": "TARQUINIA",                "tipo_nodo": "AM", "chk": "DL001381285", "lat": 42.2415653023614,  "lng": 11.7369164719456},
    {"id": 2, "id_cab": 42326, "denom": "INTERPORTO",               "tipo_nodo": "AM", "chk": "DL001380604", "lat": 41.8042856087636,  "lng": 12.2954701062645},
    {"id": 3, "id_cab": 42549, "denom": "SPOLETO",                  "tipo_nodo": "AM", "chk": "DX001381799", "lat": 42.7505753921479,  "lng": 12.725623978618},
    {"id": 4, "id_cab": 88530, "denom": "ISOLA DEL GRAN SASSO",     "tipo_nodo": "AM", "chk": "DJ001382129", "lat": 42.5033199747864,  "lng": 13.6493309925818},
    {"id": 5, "id_cab": 67723, "denom": "ROSETO",                   "tipo_nodo": "AM", "chk": "DJ001384641", "lat": 42.6556279552538,  "lng": 13.9888505400184},
    {"id": 6, "id_cab": 92153, "denom": "AVEZZANO",                 "tipo_nodo": "AM", "chk": "DJ001380375", "lat": 42.016935690562,   "lng": 13.4288710858846},
    {"id": 7, "id_cab": 82796, "denom": "MORINO",                   "tipo_nodo": "SA", "chk": "DJ001403789", "lat": 41.873282647156,   "lng": 13.4563099091071},
    {"id": 8, "id_cab": 54267, "denom": "CARTIERA BURGO - (AQ)",    "tipo_nodo": "CU", "chk": "DJ001384698", "lat": 41.9950308203531,  "lng": 13.4432315477447},
    {"id": 9, "id_cab": 59433, "denom": "CANISTRO",                 "tipo_nodo": "AM", "chk": "DJ001380678", "lat": 41.9425004932929,  "lng": 13.4106908666787},
    {"id": 10,"id_cab": 54974, "denom": "SULMONA CITTA",            "tipo_nodo": "AM", "chk": "DJ001383066", "lat": 42.059791852756,   "lng": 13.9207356075148},
]

# CORS per React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(armonizzazione_router.router)

# ===================== ENDPOINTS =======================

# Tutte le cabine
@app.get("/cabine")
async def get_cabine():
    try:
        async with SessionLocal() as session:
            result = await session.execute(text("""
                SELECT id, id_cab, denom, tipo_nodo, chk,
                       ST_X(geom::geometry) as lng,
                       ST_Y(geom::geometry) as lat
                FROM public.cabine
            """))
            rows = result.fetchall()
            cabine = [dict(row._mapping) for row in rows]
            return {"data": cabine}
    except Exception as e:
        print("[WARN] DB non disponibile, ritorno cabine finte.")
        return {"data": FAKE_CABINE}

# Cabina per codice chk
@app.get("/cabina/{id_cab}")
async def get_cabina_by_chk(id_cab: str):
    try:
        async with SessionLocal() as session:
            result = await session.execute(text("""
                SELECT ST_Y(geom::geometry) AS lat,
                       ST_X(geom::geometry) AS lng,
                       denom
                FROM public.cabine
                WHERE chk = :id_cab
            """), {"id_cab": id_cab})
            row = result.fetchone()
            if row:
                return {
                    "lat": row.lat,
                    "lng": row.lng,
                    "denom": row.denom
                }
            else:
                raise HTTPException(status_code=404, detail="Cabina non trovata")
    except Exception as e:
        print(f"[WARN] DB offline - uso cabina fake per chk={id_cab}")
        for cab in FAKE_CABINE:
            if cab["chk"] == id_cab:
                return {
                    "lat": cab["lat"],
                    "lng": cab["lng"],
                    "denom": cab["denom"]
                }
        raise HTTPException(status_code=404, detail="Cabina non trovata (fake)")

# Cabina più vicina a una posizione (lat/lng)
@app.get("/cabina_near")
async def get_cabina_near(lat: float, lng: float):
    try:
        async with SessionLocal() as session:
            result = await session.execute(text("""
                SELECT chk, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng,
                       denom,
                       ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) as dist
                FROM public.cabine
                ORDER BY dist ASC
                LIMIT 1
            """), {"lat": lat, "lng": lng})
            row = result.fetchone()
            if row:
                return {
                    "chk": row.chk,
                    "lat": row.lat,
                    "lng": row.lng,
                    "denom": row.denom
                }
            else:
                raise HTTPException(status_code=404, detail="Nessuna cabina trovata vicino al centro mappa")
    except Exception:
        print("[WARN] DB offline - ricerca cabina finta più vicina")
        import math
        def dist(c):
            return math.sqrt((c["lat"] - lat)**2 + (c["lng"] - lng)**2)
        cabina = min(FAKE_CABINE, key=dist)
        return {
            "chk": cabina["chk"],
            "lat": cabina["lat"],
            "lng": cabina["lng"],
            "denom": cabina["denom"]
        }

# Segmenta (chiama microservizio AI e ritorna la risposta)
@app.post("/segmenta")
async def segmenta_cabina(req: AIRequest):
    print("==== CHIAMATA /segmenta RICEVUTA ====")
    print("req.lat:", req.lat, "req.lng:", req.lng)
    timeout = httpx.Timeout(60.0)  # 60 secondi
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "http://localhost:9000/segmenta_ai",
                json={
                    "image": req.image,
                    "lat": req.lat,
                    "lng": req.lng,
                    "crop_width": getattr(req, "crop_width", None),
                    "crop_height": getattr(req, "crop_height", None),
                    "zoom": getattr(req, "zoom", None),
                }
            )
            print("Risposta status:", response.status_code)
            print("Risposta text:", response.text)
            response.raise_for_status()
            ai_result = response.json()
            print("Risultato JSON:", ai_result)
            return ai_result
    except httpx.ReadTimeout:
        print("Timeout della richiesta verso il microservizio AI")
        return JSONResponse(status_code=504, content={"detail": "Timeout: l'analisi AI è troppo lenta."})
    except Exception as e:
        print("ERRORE /segmenta:", e)
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": f"Errore AI: {str(e)}"})
