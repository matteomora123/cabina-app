import os
import numpy as np
from tqdm import tqdm
from PIL import Image

import torch
from torch.utils.data import Dataset, DataLoader

from transformers import SegformerForSemanticSegmentation, SegformerFeatureExtractor

# ---- PARAMETRI ----
NUM_CLASSES = 7  # 6 label + background (0)
BATCH_SIZE = 2
EPOCHS = 15
LR = 5e-5
IMAGE_SIZE = 512

class SegDataset(Dataset):
    def __init__(self, img_dir, mask_dir, feature_extractor):
        self.img_dir = img_dir
        self.mask_dir = mask_dir
        self.feature_extractor = feature_extractor

        mask_files = set(os.listdir(mask_dir))
        self.img_mask_pairs = []
        for mask_name in mask_files:
            img_base = os.path.splitext(mask_name)[0]
            img_name = img_base + ".jpg"
            img_path = os.path.join(img_dir, img_name)
            mask_path = os.path.join(mask_dir, mask_name)
            if not os.path.exists(img_path):
                print(f"ATTENZIONE: maschera {mask_name} senza immagine corrispondente ({img_name}), saltata.")
                continue

            # ---- Qui controllo che la maschera NON sia solo background ----
            mask = np.array(Image.open(mask_path))
            valori_unici = np.unique(mask)
            # Condizione: almeno un pixel diverso da 0
            if len(valori_unici) == 1 and valori_unici[0] == 0:
                print(f"ATTENZIONE: maschera {mask_name} è tutta background, saltata.")
                continue

            # (Se vuoi ALMENO 2 LABEL diverse >0)
            # if np.sum(valori_unici > 0) < 2:
            #     print(f"ATTENZIONE: maschera {mask_name} contiene meno di 2 classi label, saltata.")
            #     continue

            self.img_mask_pairs.append((img_path, mask_path))

        print(f"Totale immagini con maschera valida trovate: {len(self.img_mask_pairs)}")

    def __len__(self):
        return len(self.img_mask_pairs)

    def __getitem__(self, idx):
        img_path, mask_path = self.img_mask_pairs[idx]
        image = Image.open(img_path).convert("RGB")
        mask = Image.open(mask_path)
        mask = np.array(mask)
        if mask.shape != image.size[::-1]:
            mask = np.array(Image.fromarray(mask).resize(image.size, resample=Image.NEAREST))
        enc = self.feature_extractor(images=image, segmentation_maps=mask, return_tensors="pt")
        return {
            'pixel_values': enc['pixel_values'].squeeze(),
            'labels': enc['labels'].squeeze()
        }


if __name__ == "__main__":
    # --- QUI LE CARTELLE AUGMENTED! ---
    IMG_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\images_augmented"
    MASKS_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\masks_augmented"

    feature_extractor = SegformerFeatureExtractor(do_reduce_labels=False, size=IMAGE_SIZE)
    train_dataset = SegDataset(IMG_DIR, MASKS_DIR, feature_extractor)
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)  # num_workers=0 per debug su Windows

    model = SegformerForSemanticSegmentation.from_pretrained(
        "nvidia/segformer-b0-finetuned-ade-512-512",
        num_labels=NUM_CLASSES,
        ignore_mismatched_sizes=True
    )
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model.to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)

    for epoch in range(EPOCHS):
        model.train()
        total_loss = 0.0
        for batch in tqdm(train_loader, desc=f"Epoch {epoch+1}/{EPOCHS}"):
            optimizer.zero_grad()
            inputs = batch['pixel_values'].to(device)
            labels = batch['labels'].long().to(device)
            outputs = model(pixel_values=inputs, labels=labels)
            loss = outputs.loss
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"Epoch {epoch+1}, Loss: {total_loss / len(train_loader)}")

    SAVE_DIR = r"C:\Users\matte\PycharmProjects\cabina-app\segformer\segformer_finetuned"
    os.makedirs(SAVE_DIR, exist_ok=True)
    model.save_pretrained(SAVE_DIR)
    feature_extractor.save_pretrained(SAVE_DIR)
    print(f"Fine-tuning completo! Modello salvato in '{SAVE_DIR}/'")
