import os
import json
import numpy as np
from PIL import Image
from pycocotools import mask as maskUtils
from tqdm import tqdm
from collections import defaultdict

# Percorsi
JSON_PATH = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\instances_default.json"
IMAGES_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\images"
MASKS_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\masks"
APPLIED_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\applied_mask"
os.makedirs(MASKS_DIR, exist_ok=True)
os.makedirs(APPLIED_DIR, exist_ok=True)

# Color mapping: category_id : (R, G, B)
LABEL_COLORS = {
    1: (242, 92, 84),    # Stalli AT
    2: (254, 215, 102),  # Locale AT/MT
    3: (163, 147, 249),  # Parcheggio
    4: (148, 232, 180),  # Zona libera/Verde
    5: (255, 99, 195),   # arrivo AT
    6: (243, 129, 129),  # Strada
}

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    coco = json.load(f)

id2file = {img['id']: img['file_name'] for img in coco['images']}
cat2idx = {cat['id']: cat['id'] for cat in coco['categories']} # 1:1 mapping

# Raggruppa le annotazioni per image_id
anno_per_img = defaultdict(list)
for ann in coco['annotations']:
    anno_per_img[ann['image_id']].append(ann)

for img in tqdm(coco['images'], desc="Gen. mask + overlay"):
    file_name = img['file_name']
    image_id = img['id']
    w, h = img['width'], img['height']

    # --- Se non ci sono almeno 2 annotazioni, skippa ---
    if len(anno_per_img[image_id]) < 2:
        # print(f"SKIP: {file_name} ha solo {len(anno_per_img[image_id])} oggetto/i")
        continue

    mask = np.zeros((h, w), dtype=np.uint8)
    found_labels = set()
    for ann in anno_per_img[image_id]:
        cat = ann['category_id']
        idx = cat2idx[cat]
        found_labels.add(cat)
        if 'segmentation' in ann:
            if isinstance(ann['segmentation'], list):  # Polygon
                rles = maskUtils.frPyObjects(ann['segmentation'], h, w)
                rle = maskUtils.merge(rles)
            else:
                rle = ann['segmentation']
                if isinstance(rle['counts'], list):
                    pass
                elif isinstance(rle['counts'], str):
                    rle['counts'] = rle['counts'].encode('utf-8')

            if isinstance(rle['counts'], list):
                rle_obj = maskUtils.frPyObjects(rle, h, w)
                m = maskUtils.decode(rle_obj)
            else:
                if isinstance(rle['counts'], str):
                    rle['counts'] = rle['counts'].encode('utf-8')
                m = maskUtils.decode(rle)
            mask[m == 1] = idx

    # Salva la maschera SOLO se ci sono almeno 2 annotazioni reali
    if len(found_labels) >= 2:
        print(f"Image {file_name} -> labels presenti: {found_labels}")
        outname = os.path.splitext(file_name)[0] + ".png"
        outpath = os.path.join(MASKS_DIR, outname)
        Image.fromarray(mask).save(outpath)

        # Fai overlay SOLO se ci sono almeno 2 label
        orig = Image.open(os.path.join(IMAGES_DIR, file_name)).convert("RGBA")
        overlay = orig.copy()
        overlay_mask = np.zeros((h, w, 4), dtype=np.uint8)
        for cat_id, color in LABEL_COLORS.items():
            overlay_mask[mask == cat_id] = (*color, 120)
        overlay_img = Image.fromarray(overlay_mask)
        composite = Image.alpha_composite(overlay, overlay_img)
        composite.save(os.path.join(APPLIED_DIR, outname))

print("Fatto! Maschere PNG (e overlay) salvate SOLO per immagini con almeno 2 oggetti/mask.")
