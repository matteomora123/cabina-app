#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
FEATURES_CSV = BASE_DIR / "features.csv"
SELECTION_CSV = BASE_DIR.parent / "new_images_segV2" / "to_label_selection.csv"

def read_csv(path: Path, label: str) -> pd.DataFrame:
    if not path.exists():
        print(f"[ERR ] {label} non trovato: {path}", file=sys.stderr)
        sys.exit(1)
    df = pd.read_csv(path)
    print(f"[OK] Caricato {label}: {len(df)} righe")
    return df

print("=== STATISTICHE PRE-LABELING ===")
features_df  = read_csv(FEATURES_CSV, "features.csv").drop_duplicates(subset=["chk"])
selection_df = read_csv(SELECTION_CSV, "to_label_selection.csv").drop_duplicates(subset=["chk"])

n_all = len(features_df)
n_sel = len(selection_df)
print(f"Feature totali: {n_all} (chk unici: {features_df['chk'].nunique()})")
print(f"Selezionati:    {n_sel} (chk unici: {selection_df['chk'].nunique()})\n")

# Distribuzione per regione
feat_by_reg = features_df.groupby("regione").size().reset_index(name="disponibili")
sel_by_reg  = selection_df.groupby("regione").size().reset_index(name="selezionati")
dist = feat_by_reg.merge(sel_by_reg, on="regione", how="left").fillna(0)
dist["selezionati"] = dist["selezionati"].astype(int)
dist["quota_%"] = (dist["selezionati"] / dist["disponibili"] * 100).round(1)

print(f"{'Regione':30} {'Disponibili':>12} {'Selezionati':>12} {'Quota%':>8}")
for _, r in dist.iterrows():
    print(f"{r['regione']:<30} {r['disponibili']:>12} {r['selezionati']:>12} {r['quota_%']:>7.1f}")
