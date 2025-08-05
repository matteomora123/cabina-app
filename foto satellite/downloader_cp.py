import pandas as pd
import requests
from PIL import Image
from io import BytesIO
import math
import os

# ---- CONFIGURAZIONE ----

EXCEL_PATH = r"C:\Users\matte\PycharmProjects\cabina-app\foto satellite\CP_AUI_latlong.xlsx"
COL_CODICE = "Codice_AUI"
COL_LAT = "latitudine"
COL_LON = "longitudine"
DEST_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\foto satellite\download_sat"
os.makedirs(DEST_DIR, exist_ok=True)

TILE_SIZE = 256
ZOOM = 19              # <-- imposta qui lo zoom desiderato
IMG_PX_SIZE = 1024
TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    x_tile = int((lon_deg + 180.0) / 360.0 * n)
    y_tile = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x_tile, y_tile

def download_tile(z, x, y):
    url = TILE_URL.format(z=z, x=x, y=y)
    print(f"Scarico tile z={z}, x={x}, y={y} ...", end=" ")
    r = requests.get(url)
    if r.status_code == 200:
        print("OK")
        return Image.open(BytesIO(r.content))
    else:
        print(f"ERRORE {r.status_code}")
        return None

def merge_tiles(center_x, center_y, zoom, img_px_size):
    tiles_per_side = math.ceil(img_px_size / TILE_SIZE)
    half = tiles_per_side // 2

    tiles = []
    for dy in range(-half, half + 1):
        row = []
        for dx in range(-half, half + 1):
            tile_x = center_x + dx
            tile_y = center_y + dy
            tile_img = download_tile(zoom, tile_x, tile_y)
            if tile_img is None:
                tile_img = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (0, 0, 0))
            row.append(tile_img)
        tiles.append(row)

    mosaic_size = tiles_per_side * TILE_SIZE
    mosaic = Image.new("RGB", (mosaic_size, mosaic_size))
    for j, row in enumerate(tiles):
        for i, tile in enumerate(row):
            mosaic.paste(tile, (i * TILE_SIZE, j * TILE_SIZE))
    left = (mosaic_size - img_px_size) // 2
    upper = (mosaic_size - img_px_size) // 2
    print("Mosaico completato, effettuo crop centrale.")
    return mosaic.crop((left, upper, left + img_px_size, upper + img_px_size))

# ... [resto del codice invariato]

MAX_IMAGES = 100  # <-- Cambia qui il numero massimo di immagini che vuoi scaricare (None per tutte)

df = pd.read_excel(EXCEL_PATH)
# Filtra solo le righe valide (senza NaN)
valid_rows = df[~(df[COL_LAT].isna() | df[COL_LON].isna())]

if MAX_IMAGES is not None:
    valid_rows = valid_rows.iloc[:MAX_IMAGES]

num_to_download = valid_rows.shape[0]
print(f"\n*** Immagini da scaricare: {num_to_download} ***\n")

img_downloaded = 0

for idx, row in valid_rows.iterrows():
    lat = float(row[COL_LAT])
    lon = float(row[COL_LON])
    codice = str(row[COL_CODICE])

    print(f"\n>>> [{img_downloaded+1}/{num_to_download}] {codice} - ({lat}, {lon}) - Scarico immagine...")
    x, y = deg2num(lat, lon, ZOOM)
    img = merge_tiles(x, y, ZOOM, IMG_PX_SIZE)
    out_path = os.path.join(DEST_DIR, f"{codice}_{lat}_{lon}_zoom{ZOOM}.jpg")
    img.save(out_path)
    print(f"Salvata: {out_path}")
    img_downloaded += 1

print(f"\n*** FINE SCRIPT! Immagini scaricate: {img_downloaded} su {num_to_download} ***")
