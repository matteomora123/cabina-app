import pandas as pd
from sqlalchemy import create_engine, text

# 📄 Percorso al file CSV
csv_path = r"E:\Lavoro\Hosting analisi\shapefile input\CP-GPS CSV aprile 2025.csv"

# 🔐 Connessione PostgreSQL (modifica la password se serve)
db_url = "postgresql+psycopg2://postgres:1234@localhost:5432/cabine_primarie"
engine = create_engine(db_url)

# 📥 Carica il CSV
df = pd.read_csv(csv_path, sep=";")

print("Colonne trovate nel CSV:")
print(df.columns.tolist())

# ➕ Crea colonna 'geom' con WKT → PostGIS
df["geom"] = df["wkt_geom"].apply(lambda wkt: f"ST_GeomFromText('{wkt}', 4326)")

# 📤 Carica nel DB senza geom (PostGIS) ancora
df.drop(columns=["geom"]).to_sql("cabine", engine, if_exists="replace", index=False)

# 🧱 Aggiungi colonna geom e popola
with engine.connect() as conn:
    conn.execute(text("ALTER TABLE cabine ADD COLUMN geom geometry(Point, 4326);"))
    conn.execute(text("UPDATE cabine SET geom = ST_GeomFromText(wkt_geom, 4326);"))
    conn.commit()

print("✅ CSV importato con successo nel database!")
