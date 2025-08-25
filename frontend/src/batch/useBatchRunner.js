// src/batch/useBatchRunner.js
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { BATCH_SETTINGS } from "./config";
import { convertPolygonData } from "../utils/geo";
import { captureMapShot, waitForMapToSettleStrict } from "../utils/capture-guards";

export function useBatchRunner({
  mapRef,
  setCoords,
  setHideMarkers,
  setArmonizedMarker,
  getCenterCoords,
}) {
  // ---------- utils ----------
  const logBuffer = [];
  const pushLog = (setLogs, msg, level = "info") => {
    const item = { ts: Date.now(), msg, level };
    logBuffer.push(item);
    setLogs((prev) => [...prev, item]);
  };

  // attende due frame per essere sicuri che il DOM sia aggiornato
  const raf2 = () =>
    new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );

  // Nasconde/mostra TUTTI gli overlay che possono finire nello scatto
  function toggleLeafletOverlaysHidden(hide) {
    const selectors = [
      ".leaflet-marker-icon",
      ".leaflet-marker-shadow",
      ".marker-cluster",
      ".leaflet-popup",
      ".leaflet-tooltip",
    ];
    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      if (hide) {
        el.setAttribute("data-prev-visibility", el.style.visibility || "");
        el.style.visibility = "hidden";
      } else {
        el.style.visibility = el.getAttribute("data-prev-visibility") || "";
        el.removeAttribute("data-prev-visibility");
      }
    });

    // Overlay UI proprietari (croce rossa, bussola, badge, ecc.)
    document.querySelectorAll(".capture-hide").forEach((el) => {
      if (hide) {
        el.setAttribute("data-prev-visibility", el.style.visibility || "");
        el.style.visibility = "hidden";
      } else {
        el.style.visibility = el.getAttribute("data-prev-visibility") || "";
        el.removeAttribute("data-prev-visibility");
      }
    });
  }

  async function beginCleanCapture() {
    // prova a spegnere via stato...
    setHideMarkers?.(true);
    // ...ma soprattutto nascondi il DOM immediatamente
    toggleLeafletOverlaysHidden(true);
    // aspetta che il repaint sia effettivo
    await raf2();
  }
  function endCleanCapture() {
    toggleLeafletOverlaysHidden(false);
    setHideMarkers?.(false);
  }

  // ---------- armonizzazione iterativa ----------
  async function armonizzaSingola({ chk, lat, lng }, setLogs, settings) {
    let currentLat = +lat,
      currentLng = +lng;
    const crop = settings.cropSize;
    const map = mapRef.current;
    const leafletEl = document.querySelector(".leaflet-container");

    for (let step = 1; step <= settings.maxIter; step++) {
      const parent = leafletEl.parentElement;
      const originalTransform = parent.style.transform;
      parent.style.transform = "none";

      await beginCleanCapture();
      try {
        // scatto veloce per armonizzazione
        const rect = leafletEl.getBoundingClientRect();
        const full = await html2canvas(leafletEl, {
          useCORS: true,
          backgroundColor: null,
          allowTaint: true,
          logging: false,
          scale: settings.html2canvasScale,
        });

        const scale = full.width / rect.width;
        const cx = (rect.width / 2 - crop / 2) * scale;
        const cy = (rect.height / 2 - crop / 2) * scale;

        const canvas = document.createElement("canvas");
        canvas.width = crop;
        canvas.height = crop;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          full,
          cx,
          cy,
          crop * scale,
          crop * scale,
          0,
          0,
          crop,
          crop
        );
        const imageData = canvas.toDataURL("image/jpeg", 0.88);

        const body = {
          chk,
          zoom: map?.getZoom() ?? settings.targetZoom,
          crop_size: crop,
          image: imageData,
          bearing: map?.getBearing?.() ?? 0,
          ...(step > 1 ? { lat: currentLat, lng: currentLng } : {}),
        };

        const resp = await fetch(
          "http://localhost:8000/update_centered_coord",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw new Error(result?.detail || "errore armonizzazione");

        currentLat = result.new_lat;
        currentLng = result.new_lng;
        setArmonizedMarker({ lat: currentLat, lng: currentLng, chk });
        setCoords([currentLat, currentLng]);

        // evita animazioni (niente moveend/zoomend)
        map?.setView([currentLat, currentLng], settings.targetZoom, { animate: false });
        await raf2();

        pushLog(
          setLogs,
          `→ iter ${step}: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`
        );

        if (result.done) break;
        await new Promise((r) => setTimeout(r, settings.iterDelayMs));
      } finally {
        endCleanCapture();
        parent.style.transform = originalTransform;
      }
    }
    return { lat: currentLat, lng: currentLng };
  }

  // ---------- scatto finale pulito ----------
  // dentro src/batch/useBatchRunner.js
async function scatta(map, settings) {
  const leafletEl = document.querySelector(".leaflet-container");
  const parent = leafletEl.parentElement;
  const originalTransform = parent.style.transform;
  parent.style.transform = "none";

  await beginCleanCapture();
  try {
    const strictMs = settings.captureStrictWaitMs ?? 900; // attesa stretta < 1s
    const minTiles = settings.captureMinTiles ?? 8;       // più tile -> meno neri
    await waitForMapToSettleStrict(mapRef.current, {
      minLoaded: minTiles,
      maxWaitMs: strictMs,
    });

    const crop = settings.cropSize;
    let dataUrl;

    // retry robusto sui frame neri
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        dataUrl = await captureMapShot(mapRef, {
          crop,
          scale: settings.html2canvasScale,
          mime: "image/jpeg",
          quality: 0.88,
        });
        break; // ok
      } catch (e) {
        if (e.message !== "black-capture" || attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 120));
        await new Promise(r => requestAnimationFrame(r));
        await waitForMapToSettleStrict(mapRef.current, {
          minLoaded: minTiles,
          maxWaitMs: 400,
        });
      }
    }

    return {
      dataUrl,
      crop,
      zoom: map?.getZoom() ?? settings.targetZoom,
      bearing: map?.getBearing?.() ?? 0,
    };
  } finally {
    endCleanCapture();
    parent.style.transform = originalTransform;
  }
}

  // ---------- chiamata AI ----------
  async function segmenta({ image, center, crop, zoom }, setLogs) {
    const res = await fetch("http://localhost:8000/segmenta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        lat: center[0],
        lng: center[1],
        crop_width: crop,
        crop_height: crop,
        zoom,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.poligoni)
      throw new Error(data?.detail || "segmentazione fallita");
    return data.poligoni;
  }

  // ---------- excel ----------
  function toXlsx(rows) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "aree_per_chk");
    XLSX.writeFile(wb, `aree_cabine_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ---------- runner ----------
  async function runBatch(cabine, ui) {
    const settings = { ...BATCH_SETTINGS };
    const map = mapRef.current;
    const total = cabine.length;

    ui.setLogs([]);
    ui.setProgress(0);
    ui.setStatus(`Avvio batch su ${total} cabine…`);
    ui.setOpen(true);

    const outRows = [];
    for (let i = 0; i < total; i++) {
      const c = cabine[i];
      const label = `${c.chk || `(${c.lat.toFixed(6)},${c.lng.toFixed(6)})`}`;
      ui.setStatus(`Armonizzazione cabina ${i + 1} di ${total} — ${label}`);
      ui.setProgress(i / total);
      pushLog(ui.setLogs, `Cabina ${i + 1}/${total} [${label}]`);

      try {
        // ---- DOVE CAMBIARE LA CENTRATURA ----
        // Niente animazione: 0 eventi 'moveend/zoomend', una resa di frame e via
        map?.setView([+c.lat, +c.lng], settings.targetZoom, { animate: false });
        await raf2();

        const tArm0 = performance.now();
        const { lat, lng } = await armonizzaSingola(
          { chk: c.chk, lat: c.lat, lng: c.lng },
          ui.setLogs,
          settings
        );
        const tArm = Math.round(performance.now() - tArm0);
        pushLog(ui.setLogs, `⏱️ armonizza: ${tArm} ms`);

        pushLog(ui.setLogs, `Scatto a zoom ${settings.targetZoom}…`);
        const tCap0 = performance.now();
        const shot = await scatta(map, settings);
        const tCap = Math.round(performance.now() - tCap0);
        pushLog(ui.setLogs, `⏱️ capture: ${tCap} ms`);

        const centerCoords = getCenterCoords(); // letti dall’overlay live

        const tSeg0 = performance.now();
        const poligoniPx = await segmenta(
          {
            image: shot.dataUrl,
            center: centerCoords,
            crop: shot.crop,
            zoom: shot.zoom,
          },
          ui.setLogs
        );
        const tSeg = Math.round(performance.now() - tSeg0);
        pushLog(ui.setLogs, `⏱️ segmenta: ${tSeg} ms`);

        const converted = convertPolygonData(poligoniPx, {
          crop_width: shot.crop,
          crop_height: shot.crop,
          zoom: shot.zoom,
          centerLat: centerCoords[0],
          centerLng: centerCoords[1],
          bearing: shot.bearing,
        });

        converted.forEach((p) => {
          outRows.push({
            chk: c.chk,
            tipo: p.label || p.tipo || "n/d",
            mq: p.mq ?? 0,
            lat: lat,
            lng: lng,
          });
        });

        pushLog(ui.setLogs, `OK. Poligoni: ${converted.length}.`);
      } catch (e) {
        pushLog(ui.setLogs, `ERRORE: ${e.message || e}`, "error");
      }
    }

    ui.setStatus(`Completato. Genero Excel…`);
    ui.setProgress(1);
    toXlsx(outRows);
    pushLog(ui.setLogs, `Excel scritto con ${outRows.length} righe.`);
    ui.setStatus(`Fatto.`);
  }

  return { runBatch };
}
