import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"  # Fix OpenMP issue su Windows

import numpy as np
from PIL import Image
import albumentations as A
from tqdm import tqdm

# --- CONFIG ---
IMG_DIR = r'C:\Users\matte\PycharmProjects\cabina-app\segformer\images'
MASK_DIR = r'C:\Users\matte\PycharmProjects\cabina-app\segformer\masks'

OUT_IMG_DIR = r'C:\Users\matte\PycharmProjects\cabina-app\segformer\images_augmented'
OUT_MASK_DIR = r'C:\Users\matte\PycharmProjects\cabina-app\segformer\masks_augmented'
OUT_APPLIED_DIR = r'C:\Users\matte\PycharmProjects\cabina-app\segformer\applied_masks_augmented'

AUGS_PER_IMAGE = 4

os.makedirs(OUT_IMG_DIR, exist_ok=True)
os.makedirs(OUT_MASK_DIR, exist_ok=True)
os.makedirs(OUT_APPLIED_DIR, exist_ok=True)

PALETTE = {
    0: (0,0,0),           # background
    1: (255,160,122),     # Stalli AT
    2: (255,224,130),     # Locale AT/MT
    3: (179,157,219),     # Parcheggio
    4: (178,223,219),     # Zona libera/Verde
    5: (244,143,177),     # arrivo AT
    6: (248,187,208)      # Strada
}

transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.5),
    A.RandomRotate90(p=0.5),
    A.ShiftScaleRotate(shift_limit=0.06, scale_limit=0.10, rotate_limit=25, border_mode=0, p=0.7),
    A.RandomBrightnessContrast(p=0.2),
])

def apply_mask_overlay(image, mask, alpha=0.45):
    color_mask = np.zeros_like(image)
    for k, rgb in PALETTE.items():
        color_mask[mask==k] = rgb
    overlay = (image * (1-alpha) + color_mask * alpha).astype(np.uint8)
    return overlay

# --- SOLO immagini che hanno una maschera corrispondente ---
mask_files = sorted([f for f in os.listdir(MASK_DIR) if f.lower().endswith('.png')])
paired_imgs = []
for mask_name in mask_files:
    base = os.path.splitext(mask_name)[0]
    # Prova le varie estensioni se serve (.jpg, .jpeg, .png)
    for ext in ['.jpg', '.jpeg', '.png']:
        img_name = base + ext
        img_path = os.path.join(IMG_DIR, img_name)
        if os.path.exists(img_path):
            paired_imgs.append((img_path, os.path.join(MASK_DIR, mask_name), base, ext))
            break
    else:
        print(f"ATTENZIONE: maschera {mask_name} senza immagine corrispondente, salto!")

print(f"Farò augmentation SOLO per {len(paired_imgs)} immagini (quante maschere trovate).")

for img_path, mask_path, base, ext in tqdm(paired_imgs, desc="Augmenting"):
    image = np.array(Image.open(img_path).convert("RGB"))
    mask = np.array(Image.open(mask_path))

    for i in range(AUGS_PER_IMAGE):
        aug = transform(image=image, mask=mask)
        aug_img = aug['image']
        aug_mask = aug['mask']

        out_img_name = f"{base}_aug{i+1}{ext}"
        out_mask_name = f"{base}_aug{i+1}.png"

        Image.fromarray(aug_img).save(os.path.join(OUT_IMG_DIR, out_img_name))
        Image.fromarray(aug_mask.astype(np.uint8)).save(os.path.join(OUT_MASK_DIR, out_mask_name))
        # Overlay
        overlay = apply_mask_overlay(aug_img, aug_mask)
        Image.fromarray(overlay).save(os.path.join(OUT_APPLIED_DIR, out_img_name))

print("Fatto! SOLO immagini con maschera sono state aumentate.")
