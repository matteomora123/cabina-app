# backend/main.py

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from armonizzazione_single_cabin import router as armonizzazione_router
from schemas import AIRequest
from db import SessionLocal
import httpx
from fastapi.responses import JSONResponse
from typing import List, Optional
import asyncio

app = FastAPI()
limits = httpx.Limits(max_keepalive_connections=5, max_connections=8)
timeout = httpx.Timeout(60.0)
ai_client = httpx.AsyncClient(limits=limits, timeout=timeout)
ai_semaphore = asyncio.Semaphore(4)  # max 4 richieste AI contemporanee

FAKE_CABINE = [
    {"id": 37259, "id_cab": 51844, "denom": "VASTO", "tipo_nodo": "AM", "chk": "DJ001380914", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA ABRUZZO MARCHE E MOLISE", "regione": "ABRUZZO", "provincia": "CH", "lng": 14.694731762253099, "lat": 42.1511083275595},
    {"id": 228017, "id_cab": 237478, "denom": "SANTERAMO CP", "tipo_nodo": "AM", "chk": "DW001383828", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA ABRUZZO MARCHE E MOLISE", "regione": "ABRUZZO", "provincia": "AQ", "lng": 16.690511932089, "lat": 40.7310672733221},
    {"id": 34905, "id_cab": 41475, "denom": "PISTICCI CP", "tipo_nodo": "AM", "chk": "DW001382739", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA PUGLIA E BASILICATA", "regione": "BASILICATA", "provincia": "MT", "lng": 16.5434637957144, "lat": 40.41656625131579},
    {"id": 79188, "id_cab": 102229, "denom": "ROSSANO", "tipo_nodo": "AM", "chk": "DK001382901", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA CALABRIA", "regione": "CALABRIA", "provincia": "CS", "lng": 16.6455273207324, "lat": 39.5909050795306},
    {"id": 37950, "id_cab": 51862, "denom": "CASALNUOVO", "tipo_nodo": "AM", "chk": "DN001375784", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA CAMPANIA", "regione": "CAMPANIA", "provincia": None, "lng": 14.354181754521099, "lat": 40.922248095875894},
    {"id": 44894, "id_cab": 51056, "denom": "PIACENZA LUNGOPO", "tipo_nodo": "CU", "chk": "DE001384249", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA EMILIA ROMAGNA", "regione": "EMILIA ROMAGNA", "provincia": "PC", "lng": 9.706005079380049, "lat": 45.0571725101022},
    {"id": 52412, "id_cab": 50517, "denom": "OVARO", "tipo_nodo": "AM", "chk": "DV001384241", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA VENETO-FRIULI VENEZIA GIULIA", "regione": "FRIULI-VENEZIA GIULIA", "provincia": "UD", "lng": 12.8631686593453, "lat": 46.509824296031894},
    {"id": 82957, "id_cab": 63842, "denom": "CONS. S.DORLIGO", "tipo_nodo": "CU", "chk": "DV001384085", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA VENETO-FRIULI VENEZIA GIULIA", "regione": "FRIULI VENEZIA GIULIA", "provincia": "UD", "lng": 13.853089129003399, "lat": 45.6142475502188},
    {"id": 36352, "id_cab": 47211, "denom": "TARQUINIA", "tipo_nodo": "AM", "chk": "DL001381285", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA LAZIO", "regione": "LAZIO", "provincia": "VT", "lng": 11.7369164719456, "lat": 42.2415653023614},
    {"id": 42060, "id_cab": 45532, "denom": "CEMENTILCE", "tipo_nodo": "CU", "chk": "DY001380232", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA PIEMONTE E LIGURIA", "regione": "LIGURIA", "provincia": "SV", "lng": 8.29908726932315, "lat": 44.3691261496075},
    {"id": 43716, "id_cab": 51980, "denom": "CONCESIO", "tipo_nodo": "AM", "chk": "DU001384572", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA LOMBARDIA", "regione": "LOMBARDIA", "provincia": "BS", "lng": 10.2086952153121, "lat": 45.605127537758094},
    {"id": 48721, "id_cab": 43093, "denom": "BELFORTE", "tipo_nodo": "AM", "chk": "DJ001381986", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA ABRUZZO MARCHE E MOLISE", "regione": "MARCHE", "provincia": "MC", "lng": 13.240689825796, "lat": 43.1641039024138},
    {"id": 36625, "id_cab": 43922, "denom": "CAMPOBASSO", "tipo_nodo": "AM", "chk": "DJ001385788", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA ABRUZZO MARCHE E MOLISE", "regione": "MOLISE", "provincia": "CB", "lng": 14.64983992001, "lat": 41.5544096682648},
    {"id": 11, "id_cab": 3385, "denom": "INCISA SCAPACCINO", "tipo_nodo": "AM", "chk": "DY001383458", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA PIEMONTE E LIGURIA", "regione": "PIEMONTE", "provincia": "AT", "lng": 8.37285056427705, "lat": 44.7866262238093},
    {"id": 43760, "id_cab": 48276, "denom": "GRAVINA CP", "tipo_nodo": "AM", "chk": "DW001383814", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA PUGLIA E BASILICATA", "regione": "PUGLIA", "provincia": "BA", "lng": 16.448530513651697, "lat": 40.814570748499},
    {"id": 70196, "id_cab": 96904, "denom": "ARZACHENA 2", "tipo_nodo": "AM", "chk": "D7001381613", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA SARDEGNA", "regione": "SARDEGNA", "provincia": "SS", "lng": 9.40248161709222, "lat": 41.0652650967237},
    {"id": 60241, "id_cab": 58380, "denom": "T. NATALE", "tipo_nodo": "AM", "chk": "D8001383524", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA SICILIA", "regione": "SICILIA", "provincia": "PA", "lng": 13.2944901299017, "lat": 38.1867306315866},
    {"id": 33558, "id_cab": 51771, "denom": "S.LORENZO A GREVE", "tipo_nodo": "AM", "chk": "DX001384062", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA TOSCANA E UMBRIA", "regione": "TOSCANA", "provincia": "FI", "lng": 11.2007645470475, "lat": 43.7677813922474},
    {"id": 39975, "id_cab": 42780, "denom": "MAGIONE", "tipo_nodo": "AM", "chk": "DX001382189", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA TOSCANA E UMBRIA", "regione": "UMBRIA", "provincia": "PG", "lng": 12.2101446372229, "lat": 43.1391830242683},
    {"id": 35665, "id_cab": 51174, "denom": "VI MONTEVIALE", "tipo_nodo": "AM", "chk": "DV001384296", "tipo_cabina": "e-distribuzione", "area_regionale": "AREA VENETO-FRIULI VENEZIA GIULIA", "regione": "VENETO", "provincia": "VI", "lng": 11.4889062919471, "lat": 45.5653605014245}
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(armonizzazione_router.router)

def _tipo_expr():
    return "COALESCE(NULLIF(tipo_cabina,''), 'e-distribuzione')"

def _in_clause_from_list(name, values):
    placeholders = []
    params = {}
    for i, v in enumerate(values):
        placeholders.append(f":{name}{i}")
        params[f"{name}{i}"] = v
    return ", ".join(placeholders), params

@app.get("/filters/area_regionale")
async def list_area_regionale(tipo: List[str] = None):
    try:
        async with SessionLocal() as session:
            sql = """
                SELECT DISTINCT area_regionale
                FROM public.cabine
                WHERE area_regionale IS NOT NULL
            """
            params = {}
            if tipo:
                plc, p = _in_clause_from_list("t", tipo)
                sql += f" AND {_tipo_expr()} IN ({plc})"
                params.update(p)
            sql += " ORDER BY area_regionale"
            res = await session.execute(text(sql), params)
            return {"options": [r.area_regionale for r in res.fetchall()]}
    except Exception:
        return {"options": []}

@app.get("/filters/regione")
async def list_regione(tipo: List[str] = None, area_regionale: Optional[str] = None):
    try:
        async with SessionLocal() as session:
            sql = """
                SELECT DISTINCT regione
                FROM public.cabine
                WHERE regione IS NOT NULL
            """
            params = {}
            if tipo:
                plc, p = _in_clause_from_list("t", tipo)
                sql += f" AND {_tipo_expr()} IN ({plc})"
                params.update(p)
            if area_regionale:
                sql += " AND area_regionale = :area_regionale"
                params["area_regionale"] = area_regionale
            sql += " ORDER BY regione"
            res = await session.execute(text(sql), params)
            return {"options": [r.regione for r in res.fetchall()]}
    except Exception:
        return {"options": []}

@app.get("/filters/provincia")
async def list_provincia(
    tipo: List[str] = None,
    area_regionale: Optional[str] = None,
    regione: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 30
):
    try:
        async with SessionLocal() as session:
            sql = """
                SELECT DISTINCT provincia
                FROM public.cabine
                WHERE provincia IS NOT NULL AND provincia <> ''
            """
            params = {"limit": limit}
            if tipo:
                plc, p = _in_clause_from_list("t", tipo)
                sql += f" AND {_tipo_expr()} IN ({plc})"
                params.update(p)
            if area_regionale:
                sql += " AND area_regionale = :area_regionale"
                params["area_regionale"] = area_regionale
            if regione:
                sql += " AND regione = :regione"
                params["regione"] = regione
            if q:
                sql += " AND UPPER(provincia) LIKE UPPER(:q || '%')"
                params["q"] = q
            sql += " ORDER BY provincia LIMIT :limit"
            res = await session.execute(text(sql), params)
            return {"options": [r.provincia for r in res.fetchall()]}
    except Exception:
        return {"options": []}

@app.get("/cabine")
async def get_cabine(
    tipo: List[str] | None = Query(default=None),
    area_regionale: Optional[str] = None,
    regione: Optional[str] = None,
    provincia: Optional[str] = None,
):
    try:
        async with SessionLocal() as session:
            sql = """
                SELECT id, id_cab, denom, tipo_nodo, chk,
                       COALESCE(NULLIF(tipo_cabina, ''), 'e-distribuzione') AS tipo_cabina,
                       area_regionale, regione, provincia,
                       ST_X(geom::geometry) AS lng,
                       ST_Y(geom::geometry) AS lat
                FROM public.cabine
                WHERE 1=1
            """
            params = {}
            if tipo:
                plc, p = _in_clause_from_list("t", tipo)
                sql += f" AND {_tipo_expr()} IN ({plc})"
                params.update(p)
            if area_regionale:
                sql += " AND area_regionale = :area_regionale"
                params["area_regionale"] = area_regionale
            if regione:
                sql += " AND regione = :regione"
                params["regione"] = regione
            if provincia:
                sql += " AND UPPER(provincia) LIKE UPPER(:provincia || '%')"
                params["provincia"] = provincia
            sql += " ORDER BY id"
            result = await session.execute(text(sql), params)
            rows = result.fetchall()
            return {"data": [dict(row._mapping) for row in rows]}
    except Exception as e:
        print("[WARN] Errore /cabine:", e)
        return {"data": []}

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
                return dict(row._mapping)
            raise HTTPException(status_code=404, detail="Nessuna cabina trovata vicino")
    except Exception:
        import math
        cabina = min(FAKE_CABINE, key=lambda c: math.sqrt((c["lat"] - lat)**2 + (c["lng"] - lng)**2))
        return {k: cabina[k] for k in ["chk", "lat", "lng", "denom"]}

@app.get("/cabina/{chk}")
async def get_cabina_by_chk(chk: str):
    try:
        async with SessionLocal() as session:
            result = await session.execute(text("""
                SELECT ST_Y(geom::geometry) AS lat,
                       ST_X(geom::geometry) AS lng,
                       denom, chk
                FROM public.cabine
                WHERE chk = :chk
            """), {"chk": chk})
            row = result.fetchone()
            if row:
                return dict(row._mapping)
            raise HTTPException(status_code=404, detail="Cabina non trovata")
    except Exception:
        for cab in FAKE_CABINE:
            if cab["chk"] == chk:
                return {k: cab[k] for k in ["lat", "lng", "denom", "chk"]}
        raise HTTPException(status_code=404, detail="Cabina non trovata (fake)")

@app.get("/filters/aree")
async def get_aree(tipo: list[str] = None):
    try:
        async with SessionLocal() as session:
            where = ""
            params = {}
            if tipo:
                tipi_norm = [None if t == "e-distribuzione" else t for t in tipo]
                null_selected = any(t is None for t in tipi_norm)
                values = [t for t in tipi_norm if t is not None]
                parts = []
                if values:
                    plc, p = _in_clause_from_list("t", values)
                    parts.append(f"tipo_cabina IN ({plc})")
                    params.update(p)
                if null_selected:
                    parts.append("tipo_cabina IS NULL")
                where = "WHERE " + " OR ".join(parts) if parts else ""
            q = f"""SELECT DISTINCT area_regionale FROM public.cabine {where} ORDER BY area_regionale"""
            res = await session.execute(text(q), params)
            return {"data": [r.area_regionale for r in res.fetchall()]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/filters/regioni")
async def get_regioni(tipo: list[str] = None, area: str | None = None):
    try:
        async with SessionLocal() as session:
            clauses = []
            params = {}
            if tipo:
                tipi_norm = [None if t == "e-distribuzione" else t for t in tipo]
                null_selected = any(t is None for t in tipi_norm)
                values = [t for t in tipi_norm if t is not None]
                sub = []
                if values:
                    plc, p = _in_clause_from_list("t", values)
                    sub.append(f"tipo_cabina IN ({plc})")
                    params.update(p)
                if null_selected:
                    sub.append("tipo_cabina IS NULL")
                if sub:
                    clauses.append("(" + " OR ".join(sub) + ")")
            if area:
                clauses.append("area_regionale = :area")
                params["area"] = area
            where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            q = f"""SELECT DISTINCT regione FROM public.cabine {where} ORDER BY regione"""
            res = await session.execute(text(q), params)
            return {"data": [r.regione for r in res.fetchall()]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/filters/province")
async def get_province(tipo: list[str] = None, area: str | None = None, regione: str | None = None, q: str | None = None):
    try:
        async with SessionLocal() as session:
            clauses = []
            params = {}
            if tipo:
                tipi_norm = [None if t == "e-distribuzione" else t for t in tipo]
                null_selected = any(t is None for t in tipi_norm)
                values = [t for t in tipi_norm if t is not None]
                sub = []
                if values:
                    plc, p = _in_clause_from_list("t", values)
                    sub.append(f"tipo_cabina IN ({plc})")
                    params.update(p)
                if null_selected:
                    sub.append("tipo_cabina IS NULL")
                if sub:
                    clauses.append("(" + " OR ".join(sub) + ")")
            if area:
                clauses.append("area_regionale = :area")
                params["area"] = area
            if regione:
                clauses.append("regione = :reg")
                params["reg"] = regione
            if q:
                clauses.append("provincia ILIKE :q")
                params["q"] = q.upper() + "%"
            where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            sql = f"""SELECT DISTINCT provincia FROM public.cabine {where} ORDER BY provincia"""
            res = await session.execute(text(sql), params)
            return {"data": [r.provincia for r in res.fetchall()]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/segmenta")
async def segmenta_cabina(req: AIRequest):
    try:
        async with ai_semaphore:  # back-pressure
            response = await ai_client.post(
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
            response.raise_for_status()
            return response.json()
    except httpx.ReadTimeout:
        return JSONResponse(status_code=504, content={"detail": "Timeout: l'analisi AI è troppo lenta."})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Errore AI: {str(e)}"})

@app.on_event("shutdown")
async def _close_clients():
    await ai_client.aclose()
