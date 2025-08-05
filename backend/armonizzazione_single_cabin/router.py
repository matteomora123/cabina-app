from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from db import SessionLocal
from .coord_optimizer import CoordinateOptimizationRequest, ottimizza_coordinata

router = APIRouter()

@router.post("/update_centered_coord")
async def update_centered_coord(req: CoordinateOptimizationRequest):
    try:
        print(f"[SERVER] Avvio ottimizzazione per cabina {req.chk}")

        # 1. Alla PRIMA chiamata (iterazione 0): prendi SEMPRE coordinate da DB!
        if req.lat is None or req.lng is None:  # OPPURE: controlla se c'è un flag 'first_iteration'
            async with SessionLocal() as session:
                res = await session.execute(
                    text("SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM public.cabine WHERE chk = :chk"),
                    {"chk": req.chk}
                )
                row = res.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Cabina non trovata")
                lat_db = row.lat
                lng_db = row.lng
        else:
            lat_db = req.lat
            lng_db = req.lng

        # 2. Chiamata a ottimizza_coordinata con coordinate giuste
        result = await ottimizza_coordinata(
            CoordinateOptimizationRequest(
                chk=req.chk,
                zoom=req.zoom,
                crop_size=req.crop_size,
                image=req.image,
                lat=lat_db,
                lng=lng_db
            )
        )
        ...

        # Condizione di stop
        done = result.final_distance_px < 20

        if done:
            print(f"[SERVER] Armonizzazione completata")
            # Salvo nel DB solo alla fine
            async with SessionLocal() as session:
                await session.execute(
                    text("""
                        UPDATE public.cabine
                        SET geom_centered = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
                        WHERE chk = :chk
                    """),
                    {"lat": result.new_lat, "lng": result.new_lng, "chk": req.chk}
                )
                await session.commit()

        return {
            "chk": req.chk,
            "new_lat": result.new_lat,
            "new_lng": result.new_lng,
            "final_distance_px": result.final_distance_px,
            "density_score": result.density_score,
            "done": done,
            "message": "Ottimizzazione completata" if done else "Step completato, continuare"
        }

    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=f"Errore SQL: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore generico: {str(e)}")
