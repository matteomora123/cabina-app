# backend/db.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Cambia con le tue credenziali
DATABASE_URL = "postgresql+asyncpg://postgres:1234@localhost:5432/cabine_primarie"

# Creazione engine asincrono
engine = create_async_engine(DATABASE_URL, echo=True)

# Session factory
SessionLocal = sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession
)