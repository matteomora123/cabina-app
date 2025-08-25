// src/utils/capture-guards.js
import html2canvas from "html2canvas";

/**
 * Attende che la mappa sia "quasi idle" e che ci sia un numero minimo di tile
 * visibili, completi e con opacità ~1. Timeout breve e parametrico.
 */
export async function waitForMapToSettleStrict(map, {
  minLoaded = 6,
  maxWaitMs = 900
} = {}) {
  if (!map) return;

  const start = performance.now();
  // 1 frame per completare il layout
  await new Promise(r => requestAnimationFrame(r));

  // loop veloce: appena trovi abbastanza tile "buoni", esci
  while (performance.now() - start < maxWaitMs) {
    const ok = countReadyTiles() >= minLoaded;
    if (ok) return;
    await new Promise(r => requestAnimationFrame(r));
  }
  // timeout: prosegui comunque (meglio catturare che bloccare il batch)
}

function countReadyTiles() {
  const tiles = Array.from(document.querySelectorAll("img.leaflet-tile"));
  // completi, con dimensioni >0 e opacità ~1 (no fade-in)
  let n = 0;
  for (const t of tiles) {
    const s = getComputedStyle(t);
    if (
      t.complete &&
      t.naturalWidth > 0 &&
      t.naturalHeight > 0 &&
      parseFloat(s.opacity || "1") > 0.95 &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    ) n++;
  }
  return n;
}

/**
 * Cattura la mappa e ritorna il crop centrale. Se la cattura è "nera",
 * lancia Error("black-capture") così chi chiama può ritentare.
 */
export async function captureMapShot(mapRef, {
  crop = 500,
  scale = 1,
  mime = "image/jpeg",
  quality = 0.9,
} = {}) {
  const leafletEl = document.querySelector(".leaflet-container");
  if (!leafletEl) throw new Error("leaflet container non trovato");

  const rect = leafletEl.getBoundingClientRect();

  // canvas pieno
  const full = await html2canvas(leafletEl, {
    useCORS: true,
    backgroundColor: null,
    logging: false,
    scale,
    imageTimeout: 800, // evita che html2canvas aspetti 15s: gestiamo noi i tile
  });

  // crop centrale
  const scaleFactor = full.width / rect.width;
  const cx = (rect.width / 2 - crop / 2) * scaleFactor;
  const cy = (rect.height / 2 - crop / 2) * scaleFactor;

  const c = document.createElement("canvas");
  c.width = crop;
  c.height = crop;
  const ctx = c.getContext("2d");
  ctx.drawImage(
    full,
    cx, cy,
    crop * scaleFactor, crop * scaleFactor,
    0, 0,
    crop, crop
  );

  // rileva "nero" (o completamente vuoto)
  if (isProbablyBlack(c)) {
    throw new Error("black-capture");
  }

  return c.toDataURL(mime, quality);
}

function isProbablyBlack(canvas) {
  const ctx = canvas.getContext("2d");
  // campiona 5x5 al centro + 4 angoli (tot 9 campioni)
  const samples = [
    [canvas.width/2, canvas.height/2],
    [8, 8],
    [canvas.width-8, 8],
    [8, canvas.height-8],
    [canvas.width-8, canvas.height-8],
    [canvas.width/2, 8],
    [8, canvas.height/2],
    [canvas.width-8, canvas.height/2],
    [canvas.width/2, canvas.height-8],
  ];

  let sum = 0;
  for (const [x,y] of samples) {
    const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    // luminanza semplice
    sum += (0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2]);
  }
  const avg = sum / samples.length; // 0..255
  return avg < 6; // praticamente nero
}
