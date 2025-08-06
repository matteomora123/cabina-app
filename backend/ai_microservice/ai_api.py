#backend/ai_microservice/ai_api.py

from fastapi import FastAPI
from pydantic import BaseModel
from io import BytesIO
import base64
from PIL import Image
import torch
import numpy as np
from transformers import SegformerForSemanticSegmentation, SegformerFeatureExtractor
import cv2
import os
from datetime import datetime

# ======= MAPPING CLASSI CVAT =======
CVAT_CLASSES = [
    {"id": 0, "label": "background",           "color": "#000000"},
    {"id": 1, "label": "Stalli AT",            "color": "#FFA07A"},
    {"id": 2, "label": "Locale AT/MT",         "color": "#FFE082"},
    {"id": 3, "label": "Parcheggio",           "color": "#B39DDB"},
    {"id": 4, "label": "Zona libera/Verde",    "color": "#B2DFDB"},
    {"id": 5, "label": "arrivo AT",            "color": "#F48FB1"},
    {"id": 6, "label": "Strada",               "color": "#F8BBD0"}
]
ID_TO_CLASS = {c["id"]: c for c in CVAT_CLASSES}
PALETTE = {c["id"]: tuple(int(c["color"].lstrip("#")[i:i+2], 16) for i in (0, 2, 4)) for c in CVAT_CLASSES}

# Percorsi modello e output
MODEL_PATH = r"..\segformer\segformer_finetuned"
OUTPUT_DIR = r"ai_microservice\output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Caricamento modello e feature_extractor...")
model = SegformerForSemanticSegmentation.from_pretrained(MODEL_PATH)
feature_extractor = SegformerFeatureExtractor.from_pretrained(MODEL_PATH)
model.eval()
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device)

app = FastAPI()

class SegmentRequest(BaseModel):
    image: str  # base64-encoded JPEG/PNG

def overlay_mask_on_image(image, pred, alpha=0.45):
    image = np.array(image.convert("RGB"))
    mask_rgb = np.zeros_like(image)
    for k, rgb in PALETTE.items():
        mask_rgb[pred == k] = rgb
    overlay = (image * (1 - alpha) + mask_rgb * alpha).astype(np.uint8)
    return overlay

def save_overlay(img, pred):
    # Crea nome file unico con data + progressivo
    base_name = datetime.now().strftime("%Y%m%d")
    prog = 1
    while True:
        out_name = f"{base_name}_{prog}.jpg"
        out_path = os.path.join(OUTPUT_DIR, out_name)
        if not os.path.exists(out_path):
            break
        prog += 1
    overlay_img = overlay_mask_on_image(img, pred)
    Image.fromarray(overlay_img).save(out_path)
    print(f"[SALVATO] Overlay maschera: {out_path}")

@app.post("/segmenta_ai")
def segmenta_ai(req: SegmentRequest):
    try:
        print("\n--- DEBUG ---\nRicevuta immagine base64 di lunghezza:", len(req.image))
        header, encoded = req.image.split(',', 1)
        img = Image.open(BytesIO(base64.b64decode(encoded))).convert("RGB")
        print("Immagine decodificata, shape:", img.size)

        # Preprocessing e predizione
        inputs = feature_extractor(images=img, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        pred = outputs.logits.argmax(dim=1).squeeze().cpu().numpy()

        # Resize predizione alla shape dell'immagine originale
        pred = np.array(
            Image.fromarray(pred.astype(np.uint8)).resize(img.size, resample=Image.NEAREST)
        )

        # Salva overlay maschera per debug
        save_overlay(img, pred)

        uniq, counts = np.unique(pred, return_counts=True)
        print("Classi pixel predetti e conteggi:", dict(zip(uniq, counts)))

        results = []
        for class_id in uniq:
            if class_id == 0:
                continue
            mask = (pred == class_id).astype(np.uint8)
            n_pixels = np.sum(mask)
            print(f"Classe {class_id} ({ID_TO_CLASS[class_id]['label']}): {n_pixels} pixel da segmentare")
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            print(f"  -> {len(contours)} poligoni trovati per classe {class_id}")
            for cnt in contours:
                if len(cnt) > 2:
                    poly = cnt.squeeze().tolist()
                    if isinstance(poly[0], int): poly = [poly]
                    class_info = ID_TO_CLASS.get(int(class_id), {"label": str(class_id), "color": "#222"})
                    results.append({
                        "points": poly,
                        "label": class_info["label"],
                        "color": class_info["color"],
                        "tipo": class_info["label"]
                    })
        print("Restituisco", len(results), "poligoni totali\n--- DEBUG FINE ---")
        return {"poligoni": results}
    except Exception as e:
        print("ERRORE backtrace:", e)
        return {"errore": str(e)}
