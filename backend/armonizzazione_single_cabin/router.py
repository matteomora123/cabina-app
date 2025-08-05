# backend/armonizzazione/router.py

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from db import SessionLocal
from .coord_optimizer import CoordinateOptimizationRequest, ottimizza_coordinata

router = APIRouter()

@router.post("/update_centered_coord")
async def update_centered_coord(req: CoordinateOptimizationRequest):
    """
    Endpoint per armonizzare la posizione di una cabina e aggiornare geom_centered nel DB.
    """
    try:
        # Avvia ottimizzazione
        result = await ottimizza_coordinata(req)

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
            "iterations": result.iterations,
            "final_distance_px": result.final_distance_px,
            "density_score": result.density_score,
            "message": f"Nuova coordinata centrata aggiornata nel DB per {req.chk}"
        }

    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=f"Errore SQL: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore generico: {str(e)}")
