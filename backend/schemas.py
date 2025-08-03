# schemas.py
from pydantic import BaseModel
from typing import List, Optional

class Point(BaseModel):
    lat: float
    lng: float

class PolygonZone(BaseModel):
    label: str
    tipo: str
    points: List[List[float]]
    mq: float
    color: Optional[str]
    properties: dict = {}

class AIRequest(BaseModel):
    image: str   # base64
    lat: float
    lng: float
    crop_width: Optional[int] = None
    crop_height: Optional[int] = None
    zoom: Optional[int] = None


class AIResponse(BaseModel):
    poligoni: List[PolygonZone]
    cabina_chk: Optional[str]
