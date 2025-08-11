#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import math
import io
import re
import time
import asyncio
import aiohttp
import async_timeout
import json
import random
import numpy as np
import pandas as pd
from pathlib import Path
from PIL import Image

# ===== CONFIG =====
DATABASE_URL = "postgresql+asyncpg://postgres:1234@localhost:5432/cabine_primarie"
TABLE = "public.cabine"
COL_CHK = "chk"
COL_REGIONE = "regione"
COL_PROVINCIA = "provincia"
COL_AREA = "area_regionale"
COL_GEOM_CENTERED = "geom_centered"

LABELED_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\images"
OUT_DIR = Path(r"C:\Users\matte\PycharmProjects\cabina-app\segformer\prepare_features_dataset")
IMG_DIR = OUT_DIR / "images"

ZOOM_THUMB = 15
THUMB_PX = 256
ESRI_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

RANDOM_SEED = 42
LOG_EVERY = 20        # stampa un riepilogo ogni N elementi
TIMEOUT_SEC = 10      # timeout HTTP per tile
# ==================

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


def latlon_to_pixel_offset(lat, lon, z, tile_size=256):
    lat_rad = math.radians(lat)
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n * tile_size
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * tile_size
    return int(x), int(y), int(x) % tile_size, int(y) % tile_size


async def fetch_tile(session, z, x, y, timeout_sec=TIMEOUT_SEC):
    url = ESRI_TILE_URL.format(z=z, x=x, y=y)
    async with async_timeout.timeout(timeout_sec):
        async with session.get(url) as resp:
            resp.raise_for_status()
            data = await resp.read()
            return Image.open(io.BytesIO(data)).convert("RGB")


async def fetch_centered_patch(session, lat, lon, z, out_px):
    tile_size = 256
    cx, cy, _, _ = latlon_to_pixel_offset(lat, lon, z, tile_size)
    half = out_px // 2
    x0, y0 = cx - half, cy - half
    x1, y1 = cx + half, cy + half

    def pix_to_tilecoord(p): return p // tile_size

    tx0, ty0 = pix_to_tilecoord(x0), pix_to_tilecoord(y0)
    tx1, ty1 = pix_to_tilecoord(x1), pix_to_tilecoord(y1)

    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    imgs = []
    for tx, ty in tiles:
        imgs.append(await fetch_tile(session, z, tx, ty))

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


def rgb_features(img):
    a = np.asarray(img).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mean_rgb = a.reshape(-1, 3).mean(axis=0)
    std_rgb = a.reshape(-1, 3).std(axis=0)
    v = a.max(axis=2)
    g_dom = (g > r) & (g > b)
    green_frac = g_dom.mean()
    dry_frac = ((v < 0.45) & ~g_dom).mean()
    gx = np.abs(np.diff(v, axis=1)).mean()
    gy = np.abs(np.diff(v, axis=0)).mean()
    edge_density = (gx + gy) / 2.0
    hist_r, _ = np.histogram(r, bins=16, range=(0, 1), density=True)
    hist_g, _ = np.histogram(g, bins=16, range=(0, 1), density=True)
    hist_b, _ = np.histogram(b, bins=16, range=(0, 1), density=True)
    return np.concatenate([mean_rgb, std_rgb, [green_frac, dry_frac, edge_density], hist_r, hist_g, hist_b])


def parse_labeled_set(labeled_dir):
    p = Path(labeled_dir)
    files = list(p.glob("**/*.*"))
    rows = []
    rx = re.compile(r"(?P<chk>[A-Za-z0-9]+)_+(?P<lat>[+-]?\d+\.\d+)_+(?P<lon>[+-]?\d+\.\d+)_*zoom19", re.IGNORECASE)
    for f in files:
        m = rx.search(f.name)
        if m:
            rows.append({"chk": m.group("chk")})
    df = pd.DataFrame(rows)
    return df.drop_duplicates(subset=["chk"]) if not df.empty else pd.DataFrame(columns=["chk"])


async def load_db_candidates():
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
    return df.drop_duplicates(subset=["chk"])


def _fmt_time(seconds: float) -> str:
    seconds = max(0, int(seconds))
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


async def main():
    # setup cartelle
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    print("=== PREPARE FEATURES DATASET ===")
    print(f"Output dir: {OUT_DIR}")
    print(f"Thumb dir : {IMG_DIR}")
    print(f"Zoom/thumb: z{ZOOM_THUMB}, {THUMB_PX}px\n")

    # 1) già etichettate
    labeled = parse_labeled_set(LABELED_DIR)
    print(f"→ Etichettate rilevate in LABELED_DIR: {len(labeled)}")

    # 2) DB
    print("→ Carico candidati dal DB ...")
    all_df = await load_db_candidates()
    print(f"   Candidati DB iniziali: {len(all_df)}")

    # 3) Exclude già etichettate
    if not labeled.empty:
        before = len(all_df)
        all_df = all_df[~all_df["chk"].isin(set(labeled["chk"]))].copy()
        print(f"   Esclusi (già etichettati): {before - len(all_df)}")

    total = len(all_df)
    if total == 0:
        print("Nessun candidato disponibile dopo l'esclusione. Esco.")
        return

    print(f"→ Da processare: {total} cabine\n")

    feats = []
    errors = 0
    t0 = time.time()
    last_log_time = t0

    # 4) Loop con log dettagliati e ETA
    async with aiohttp.ClientSession() as session:
        for i, r in enumerate(all_df.itertuples(index=False), start=1):
            # log puntuale
            pct = (i / total) * 100.0
            elapsed = time.time() - t0
            avg_per_it = elapsed / i
            eta = avg_per_it * (total - i)
            print(f"[{i:>5}/{total}] ({pct:6.2f}%) chk={r.chk} lat={r.lat:.6f} lon={r.lng:.6f}  "
                  f"elapsed={_fmt_time(elapsed)}  eta={_fmt_time(eta)}")

            try:
                patch = await fetch_centered_patch(session, r.lat, r.lng, ZOOM_THUMB, THUMB_PX)
                fname = f"{r.chk}_{r.lat}_{r.lng}_thumb_z{ZOOM_THUMB}.png"
                patch.save(IMG_DIR / fname)
                f = rgb_features(patch)
                # _asdict() per tornare a dict dai namedtuple fields
                rec = r._asdict() if hasattr(r, "_asdict") else dict(r._asdict())
                feats.append({**rec, "features": json.dumps(f.tolist())})

            except Exception as e:
                errors += 1
                print(f"   !! ERRORE su {r.chk}: {e}")

            # log ogni LOG_EVERY
            if i % LOG_EVERY == 0 or i == total:
                ok = len(feats)
                elapsed_blk = time.time() - last_log_time
                last_log_time = time.time()
                print(f"   └─ Progress: OK={ok}  KO={errors}  blk_time={_fmt_time(elapsed_blk)}  "
                      f"tot_time={_fmt_time(time.time()-t0)}\n")

    # 5) Salvataggio
    df_out = pd.DataFrame(feats)
    out_csv = OUT_DIR / "features.csv"
    df_out.to_csv(out_csv, index=False)

    # 6) riepilogo finale
    total_time = time.time() - t0
    print("=== FINE ===")
    print(f"Thumb salvate in: {IMG_DIR}")
    print(f"CSV feature    : {out_csv}")
    print(f"Riepilogo      : TOT={total}  OK={len(df_out)}  KO={errors}")
    print(f"Tempo totale   : { _fmt_time(total_time) }")


if __name__ == "__main__":
    asyncio.run(main())
