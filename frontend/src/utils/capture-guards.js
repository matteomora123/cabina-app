// src/utils/capture-guards.js
import html2canvas from "html2canvas";
import L from "leaflet";

/** Attesa "strict" delle tile Leaflet: almeno N tile caricate o timeout. */
export function waitForMapToSettleStrict(map, { minLoaded = 6, maxWaitMs = 4000 } = {}) {
  if (!map) return Promise.resolve();
  return new Promise((resolve) => {
    const start = performance.now();
    let inflight = 0, loaded = 0;
    const layers = [];
    map.eachLayer(l => { if (l instanceof L.TileLayer) layers.push(l); });

    const cleanup = () => {
      layers.forEach(l => {
        l.off("tileloadstart", onStart);
        l.off("tileload", onLoad);
        l.off("tileerror", onError);
      });
      resolve();
    };
    const check = () => {
      const t = performance.now() - start;
      if (inflight === 0 && loaded >= minLoaded) return cleanup();
      if (t > maxWaitMs) return cleanup(); // stop-gap
    };
    const onStart = () => { inflight++; };
    const onLoad  = () => { inflight = Math.max(0, inflight - 1); loaded++; check(); };
    const onError = () => { inflight = Math.max(0, inflight - 1); check(); };

    if (!layers.length) return resolve();

    layers.forEach(l => {
      l.on("tileloadstart", onStart);
      l.on("tileload", onLoad);
      l.on("tileerror", onError);
    });

    requestAnimationFrame(() => requestAnimationFrame(check));
    setTimeout(check, maxWaitMs + 50);
  });
}

/** Heuristica: immagine quasi nera? */
async function isMostlyBlack(dataUrl, thresh = 10, minRatio = 0.02) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let nonblack = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > thresh || data[i + 1] > thresh || data[i + 2] > thresh) nonblack++;
  }
  return (nonblack / (data.length / 4)) < minRatio;
}

/** Cattura centrata con rimozione transform e crop. Lancia "black-capture" se vuota. */
export async function captureMapShot(mapRef, { crop = 500, scale = 1 } = {}) {
  const el = document.querySelector(".leaflet-container");
  const parent = el?.parentElement;
  if (!el || !parent) throw new Error("leaflet root not found");
  const prev = parent.style.transform;
  try {
    parent.style.transform = "none";                                // 1) no transform
    await new Promise(r => requestAnimationFrame(r));
    await waitForMapToSettleStrict(mapRef.current, { minLoaded: 6 }); // 2) tile vere
    const full = await html2canvas(el, {
      useCORS: true,
      backgroundColor: null,
      allowTaint: true,
      logging: false,
      scale: scale,
    });
    const rect = el.getBoundingClientRect();
    const k = full.width / rect.width;
    const cx = (rect.width / 2 - crop / 2) * k;
    const cy = (rect.height / 2 - crop / 2) * k;

    const out = document.createElement("canvas");
    out.width = crop; out.height = crop;
    out.getContext("2d").drawImage(full, cx, cy, crop * k, crop * k, 0, 0, crop, crop);

    const dataUrl = out.toDataURL();
    if (await isMostlyBlack(dataUrl)) throw new Error("black-capture");
    return dataUrl;
  } finally {
    parent.style.transform = prev;
  }
}
