#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
# --- workaround Windows / MKL & joblib warnings ---
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "0")

import asyncio
import aiohttp
import async_timeout
import math
import io
import re
import json
import random
import numpy as np
import pandas as pd
from pathlib import Path
from PIL import Image
from typing import Dict, List
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

# ====================== CONFIG ======================
DATABASE_URL = "postgresql+asyncpg://postgres:1234@localhost:5432/cabine_primarie"

TABLE = "public.cabine"
COL_CHK = "chk"
COL_REGIONE = "regione"
COL_PROVINCIA = "provincia"
COL_AREA = "area_regionale"
COL_GEOM_CENTERED = "geom_centered"  # userò ST_Y/X(COALESCE(geom_centered, geom))

# dataset feature già preparato
FEATURES_DIR = Path(r"C:\Users\matte\PycharmProjects\cabina-app\segformer\prepare_features_dataset")
FEATURES_CSV = FEATURES_DIR / "features.csv"

LABELED_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\images"
OUTPUT_DIR  = Path(r"C:\Users\matte\PycharmProjects\cabina-app\segformer\new_images_segV2")

CSV_OUT = "to_label_selection.csv"
TOTAL_TARGET = 100
RANDOM_SEED = 42

# tiles Esri World Imagery
ESRI_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ZOOM_FULL = 19
FULL_PX = 768
# ====================================================

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# ---------------- tiles utils ----------------
def latlon_to_pixel_offset(lat: float, lon: float, z: int, tile_size=256):
    lat_rad = math.radians(lat)
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n * tile_size
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * tile_size
    return int(x), int(y), int(x) % tile_size, int(y) % tile_size


async def fetch_tile(session: aiohttp.ClientSession, z: int, x: int, y: int, timeout_sec=10) -> Image.Image:
    url = ESRI_TILE_URL.format(z=z, x=x, y=y)
    async with async_timeout.timeout(timeout_sec):
        async with session.get(url) as resp:
            resp.raise_for_status()
            data = await resp.read()
            return Image.open(io.BytesIO(data)).convert("RGB")


async def fetch_centered_patch(session: aiohttp.ClientSession, lat: float, lon: float, z: int, out_px: int) -> Image.Image:
    tile_size = 256
    cx, cy, _, _ = latlon_to_pixel_offset(lat, lon, z, tile_size)
    half = out_px // 2
    x0, y0 = cx - half, cy - half
    x1, y1 = cx + half, cy + half

    def pix_to_tilecoord(p): return p // tile_size
    tx0, ty0 = pix_to_tilecoord(x0), pix_to_tilecoord(y0)
    tx1, ty1 = pix_to_tilecoord(x1), pix_to_tilecoord(y1)

    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    imgs = [await fetch_tile(session, z, tx, ty) for tx, ty in tiles]

    xs = sorted(set(tx for tx, _ in tiles))
    ys = sorted(set(ty for _, ty in tiles))
    big = Image.new("RGB", (len(xs) * tile_size, len(ys) * tile_size))
    index = {(tx, ty): i for i, (tx, ty) in enumerate(tiles)}
    for row, ty in enumerate(ys):
        for col, tx in enumerate(xs):
            big.paste(imgs[index[(tx, ty)]], (col * tile_size, row * tile_size))

    ox = cx - tx0 * tile_size
    oy = cy - ty0 * tile_size
    left = ox - half
    top = oy - half
    return big.crop((left, top, left + out_px, top + out_px))


# -------------- IO helpers -------------------
def parse_labeled_set(labeled_dir: str) -> pd.DataFrame:
    """
    Cerca file già etichettati, estraendo il chk dal nome tipo:
    CHK_lat_lon_zoom19.(png|jpg|jpeg)
    """
    p = Path(labeled_dir)
    files = list(p.glob("**/*.*"))
    rows = []
    rx = re.compile(r"^(?P<chk>[A-Za-z0-9]+)_+[-+]?\d+\.\d+_+[-+]?\d+\.\d+_+zoom\d+", re.IGNORECASE)
    for f in files:
        m = rx.search(f.name)
        if m:
            rows.append({"chk": m.group("chk")})
    return pd.DataFrame(rows).drop_duplicates(subset=["chk"]) if rows else pd.DataFrame(columns=["chk"])


def load_features_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    # expected columns: chk, lat, lng, regione, provincia, area_regionale, features(json string)
    def parse_vec(s):
        if isinstance(s, str):
            return np.array(json.loads(s), dtype=np.float32)
        if isinstance(s, (list, np.ndarray)):
            return np.array(s, dtype=np.float32)
        return None

    df["features"] = df["features"].apply(parse_vec)
    # scarta righe senza features
    df = df[df["features"].apply(lambda x: isinstance(x, np.ndarray) and x.size > 0)]
    return df


async def load_db_view() -> pd.DataFrame:
    """
    Legge dal DB la vista candidati (solo metadati), così possiamo:
    - filtrare tipo_cabina IS NULL
    - escludere già etichettate (per chk)
    - calcolare quote per regione/provincia
    """
    from sqlalchemy import create_engine
    engine_sync = create_engine(DATABASE_URL.replace("+asyncpg", ""))
    query = f"""
        SELECT {COL_CHK} AS chk,
               ST_Y(COALESCE({COL_GEOM_CENTERED}, geom)) AS lat,
               ST_X(COALESCE({COL_GEOM_CENTERED}, geom)) AS lng,
               {COL_REGIONE} AS regione,
               {COL_PROVINCIA} AS provincia,
               COALESCE({COL_AREA}, '') AS area_regionale
        FROM {TABLE}
        WHERE tipo_cabina IS NULL
          AND COALESCE({COL_GEOM_CENTERED}, geom) IS NOT NULL
    """
    df = pd.read_sql(query, engine_sync)
    engine_sync.dispose()
    # unici per chk
    return df.drop_duplicates(subset=["chk"])


# -------------- Allocation (quote) ------------
def allocate_targets(df_all: pd.DataFrame, total: int) -> pd.DataFrame:
    """
    Assegna quote per regione proporzionali a n * priorità (macro-bonus).
    """
    print("→ Calcolo quote per regione...")
    macro = {
        "Piemonte":"Nord","Valle d'Aosta":"Nord","Lombardia":"Nord","Trentino-Alto Adige":"Nord","Veneto":"Nord",
        "Friuli-Venezia Giulia":"Nord","Liguria":"Nord","Emilia-Romagna":"Nord",
        "Toscana":"Centro","Umbria":"Centro","Marche":"Centro","Lazio":"Centro",
        "Abruzzo":"Sud","Molise":"Sud","Campania":"Sud","Puglia":"Sud","Basilicata":"Sud","Calabria":"Sud",
        "Sicilia":"Isole","Sardegna":"Isole"
    }
    base = df_all.copy()
    base["macro"] = base["regione"].map(macro).fillna("Altro")
    base["macro_bonus"] = base["macro"].map({"Nord":1.0,"Centro":1.1,"Sud":1.3,"Isole":1.4,"Altro":1.0})

    reg_stats = base.groupby("regione").agg(n=("chk","size"), w=("macro_bonus","mean")).reset_index()
    reg_stats["weight"] = reg_stats["n"] * reg_stats["w"]
    if reg_stats["weight"].sum() == 0:
        reg_stats["quota"] = (reg_stats["n"] / max(1, reg_stats["n"].sum())) * total
    else:
        reg_stats["quota"] = (reg_stats["weight"] / reg_stats["weight"].sum()) * total
    reg_stats["quota"] = reg_stats["quota"].round().fillna(0).astype(int)

    # normalizza a somma total
    diff = total - int(reg_stats["quota"].sum())
    while diff != 0 and len(reg_stats) > 0:
        idx = reg_stats["quota"].idxmin() if diff > 0 else reg_stats["quota"].idxmax()
        reg_stats.loc[idx, "quota"] += 1 if diff > 0 else -1
        diff = total - int(reg_stats["quota"].sum())

    print("   Quote per regione:")
    for _, r in reg_stats.sort_values("quota", ascending=False).iterrows():
        print(f"     {r['regione']}: {r['quota']} (n={r['n']})")

    return base.merge(reg_stats[["regione","quota"]], on="regione", how="left").fillna({"quota":0})


# -------------- Morphological pick ------------
def diversified_pick(df_feats: pd.DataFrame, quotas: Dict[str,int]) -> pd.DataFrame:
    """
    KMeans per regione sulle feature (standardizzate).
    Prende il punto più vicino al centroide per cluster.
    Rispetta i limiti quota per regione.
    """
    print("→ Selezione morfologica via KMeans per regione...")
    if df_feats.empty:
        print("   Nessuna feature disponibile.")
        return pd.DataFrame()

    picks: List[pd.DataFrame] = []
    for regione, grp in df_feats.groupby("regione"):
        q = int(quotas.get(regione, 0))
        if grp.empty or q <= 0:
            continue

        X = np.stack(grp["features"].to_list())
        X = StandardScaler().fit_transform(X)
        k = min(q, len(grp))
        if k == 1:
            picks.append(grp.iloc[[0]])
            print(f"   {regione}: quota=1 → scelto 1 campione")
            continue

        km = KMeans(n_clusters=k, n_init="auto", random_state=RANDOM_SEED)
        labels = km.fit_predict(X)
        centers = km.cluster_centers_
        sel_idx = []
        for c in range(k):
            mask = labels == c
            if not np.any(mask):
                continue
            sub = grp[mask]
            subX = X[mask]
            d = np.linalg.norm(subX - centers[c], axis=1)
            sel_idx.append(sub.index[d.argmin()])
        chosen = grp.loc[sel_idx]
        picks.append(chosen)
        print(f"   {regione}: quota={k} → scelti {len(chosen)} campioni")

    if not picks:
        return pd.DataFrame()

    res = pd.concat(picks).reset_index(drop=True)

    # Riempimento fino a TOTAL_TARGET se possibile
    if len(res) < TOTAL_TARGET:
        remaining = TOTAL_TARGET - len(res)
        pool = df_feats[~df_feats["chk"].isin(set(res["chk"]))]

        if len(pool) > 0 and remaining > 0:
            take = min(remaining, len(pool))
            extra = pool.sample(n=take, random_state=RANDOM_SEED)
            res = pd.concat([res, extra], ignore_index=True)
            print(f"   Riempimento extra: aggiunti {len(extra)} (pool residuo {len(pool)})")
        else:
            print("   Nessun pool residuo per riempimento.")

    return res.head(TOTAL_TARGET)


# -------------- Download finals ----------------
async def download_full_images(df_sel: pd.DataFrame, out_dir: Path):
    print(f"→ Scarico immagini finali (z{ZOOM_FULL}, {FULL_PX}px) in {out_dir} ...")
    out_dir.mkdir(parents=True, exist_ok=True)
    ok, ko = 0, 0
    async with aiohttp.ClientSession() as session:
        for _, r in df_sel.iterrows():
            try:
                img = await fetch_centered_patch(session, r["lat"], r["lng"], ZOOM_FULL, FULL_PX)
                # NOME RICHIESTO: CHK_lat_lon_zoom19.png
                fname = f"{r['chk']}_{r['lat']}_{r['lng']}_zoom{ZOOM_FULL}.png"
                img.save(out_dir / fname)
                ok += 1
            except Exception as e:
                print(f"   Errore su {r['chk']} ({r['lat']},{r['lng']}): {e}")
                ko += 1
    print(f"   Download completato: OK={ok}, KO={ko}")


# --------------------- MAIN -----------------------
async def main():
    print("=== Arricchimento modello (da features.csv) ===")
    if not FEATURES_CSV.exists():
        print(f"ERRORE: non trovo {FEATURES_CSV}. Esegui prima lo script di preparazione feature.")
        return

    # 0) carico features da CSV
    print(f"→ Carico feature da: {FEATURES_CSV}")
    feats_all = load_features_csv(FEATURES_CSV)
    print(f"   Feature totali in CSV: {len(feats_all)}")

    # 1) leggo DB vista candidati (tipo_cabina IS NULL)
    print("→ Leggo metadati dal DB...")
    df_db = await load_db_view()
    print(f"   Candidati DB (tipo_cabina IS NULL): {len(df_db)}")

    # 2) già etichettate da LABELED_DIR
    labeled = parse_labeled_set(LABELED_DIR)
    print(f"→ Etichettate rilevate in LABELED_DIR: {len(labeled)}")

    # 3) allineo features con DB, escludo etichettate
    print("→ Sincronizzo features con DB ed escludo già etichettate...")
    feats = feats_all.merge(df_db, on=["chk","lat","lng","regione","provincia","area_regionale"], how="inner")
    if not labeled.empty:
        feats = feats[~feats["chk"].isin(set(labeled["chk"]))].copy()
    print(f"   Candidati dopo join e esclusione etichettate: {len(feats)}")

    if feats.empty:
        print("   Nessun candidato disponibile. Esco.")
        return

    # 4) calcolo allocazioni/quote solo sui chk disponibili (feats) ma pesate con macro area
    alloc = allocate_targets(feats[["chk","regione","provincia","area_regionale"]].drop_duplicates(), min(TOTAL_TARGET, len(feats)))
    quotas = {row["regione"]: int(row["quota"]) for _, row in alloc[["regione","quota"]].drop_duplicates().iterrows()}

    # cap sul numero realmente disponibile per regione
    avail_by_reg = feats.groupby("regione").size().to_dict()
    for reg in quotas.keys():
        quotas[reg] = min(quotas[reg], avail_by_reg.get(reg, 0))
    # se la somma scende sotto TOTAL_TARGET, amen: si compensa nel riempimento extra globalmente
    print("   Quote (cap a disponibilità reale):")
    for r, q in sorted(quotas.items(), key=lambda x: -x[1]):
        print(f"     {r}: {q} (avail={avail_by_reg.get(r,0)})")

    # 5) selezione morfologica
    sel_df = diversified_pick(feats, quotas)
    print(f"→ Selezione finale: {len(sel_df)} campioni")

    if sel_df.empty:
        print("   Selezione vuota. Esco.")
        return

    # 6) download immagini finali zoom19
    await download_full_images(sel_df, OUTPUT_DIR)

    # 7) CSV metadati (senza features)
    meta = sel_df.drop(columns=["features"], errors="ignore").copy()
    out_csv = OUTPUT_DIR / CSV_OUT
    meta.to_csv(out_csv, index=False)
    print(f"→ CSV metadati salvato: {out_csv}")
    print("✓ Fine.")

if __name__ == "__main__":
    asyncio.run(main())
