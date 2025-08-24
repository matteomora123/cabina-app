// batch/useBatchRunner.js
import { useRef, useCallback } from "react";
import html2canvas from "html2canvas";
import L from "leaflet";
import { convertPolygonData } from "../utils/geo";

// ---------- RENDER HELPERS ----------
const raf2 = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function waitForMapToSettle(map) {
  if (!map) return;

  // fine animazioni
  await new Promise((res) => {
    const idle = !map._animatingZoom && !map._panAnim;
    if (idle) return res();
    const once = () => {
      map.off("moveend", once);
      map.off("zoomend", once);
      res();
    };
    map.on("moveend", once);
    map.on("zoomend", once);
  });

  // attesa tile
  const tiles = [];
  map.eachLayer((l) => l instanceof L.TileLayer && tiles.push(l));
  await Promise.all(
    tiles.map((l) =>
      l && l._loading
        ? new Promise((r) => {
            const onLoad = () => {
              l.off("load", onLoad);
              r();
            };
            l.on("load", onLoad);
          })
        : Promise.resolve()
    )
  );

  await raf2();
}

function hideCaptureUi(hide) {
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

async function captureCenteredSquare(cropSize) {
  const leafletEl = document.querySelector(".leaflet-container");
  const fullCanvas = await html2canvas(leafletEl, {
    useCORS: true,
    backgroundColor: null,
    allowTaint: true,
    logging: false,
    scale: 1,
  });
  const rect = leafletEl.getBoundingClientRect();
  const k = fullCanvas.width / rect.width;
  const cx = (rect.width / 2 - cropSize / 2) * k;
  const cy = (rect.height / 2 - cropSize / 2) * k;

  const cropped = document.createElement("canvas");
  cropped.width = cropSize;
  cropped.height = cropSize;
  const ctx = cropped.getContext("2d");
  ctx.drawImage(
    fullCanvas,
    cx,
    cy,
    cropSize * k,
    cropSize * k,
    0,
    0,
    cropSize,
    cropSize
  );
  return cropped.toDataURL();
}

// attende che i path SVG dei poligoni compaiano davvero
async function waitForPolygonsDrawn(map) {
  if (!map) return;
  const pane = map.getPanes()?.overlayPane;
  if (!pane) return;
  const hasPaths = () =>
    pane.querySelectorAll("path.leaflet-interactive").length > 0;

  if (hasPaths()) {
    await raf2();
    return;
  }
  await new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (hasPaths()) {
        obs.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }
    });
    obs.observe(pane, { childList: true, subtree: true });
  });
}

// watchdog di rete per non rimanere inchiodati
async function fetchWithWatchdog(url, options = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("watchdog-timeout"), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- HOOK ----------
export function useBatchRunner({
  mapRef,
  setCoords,
  setHideMarkers,
  setArmonizedMarker,
  getCenterCoords,
  setPolygonData,
  drawPolygons, // bool
}) {
  const runningRef = useRef(false);

  const runBatch = useCallback(
    async (cabine, ui) => {
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        ui.setOpen(true);
        ui.setLogs([]);
        ui.setStatus("Preparazione…");
        ui.setProgress(0);

        const total = cabine.length;
        const crop = 500;

        let i = 0;
        for (const cab of cabine) {
          i++;
          ui.setStatus(`(${i}/${total}) ${cab.chk ?? ""} • acquisizione`);

          // pulizia residui
          setArmonizedMarker(null);
          setPolygonData(null);

          // 1) centra mappa e aspetta
          const target = [Number(cab.lat), Number(cab.lng)];
          setCoords(target);
          const map = mapRef.current;
          if (map) map.setView(target, 19, { animate: false });
          await waitForMapToSettle(map);

          // 2) screenshot
          setHideMarkers(true);
          hideCaptureUi(true);
          await raf2();

          let dataUrl;
          try {
            dataUrl = await captureCenteredSquare(crop);
          } finally {
            hideCaptureUi(false);
            setHideMarkers(false);
          }

          const center = map.getCenter();
          const zoom = map.getZoom();
          const bearing = map.getBearing ? map.getBearing() : 0;

          // 3) SOLO PREVIEW POLIGONI con il microservizio AI (N O  S A L V A)
          if (drawPolygons) {
            try {
              const segAI = await fetchWithWatchdog(
                "http://localhost:9000/segmenta_ai",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    image: dataUrl,
                    lat: center.lat,
                    lng: center.lng,
                    zoom,
                    crop_width: crop,
                    crop_height: crop,
                  }),
                },
                60000
              );
              const segJson = await segAI.json();
              if (!segAI.ok)
                throw new Error(segJson?.detail || `HTTP ${segAI.status}`);

              if (Array.isArray(segJson.poligoni)) {
                const conv = convertPolygonData(segJson.poligoni, {
                  crop_width: crop,
                  crop_height: crop,
                  zoom,
                  centerLat: center.lat,
                  centerLng: center.lng,
                });
                setPolygonData(conv);
                await waitForPolygonsDrawn(map);
              }
            } catch (err) {
              ui.setLogs((p) => [
                ...p,
                `⚠️ ${cab.chk}: preview poligoni fallita (${String(err)})`,
              ]);
            }
          }

          // 4) NORMALIZZAZIONE GUIDATA DAL BACKEND
          ui.setStatus(`(${i}/${total}) ${cab.chk ?? ""} • norm …`);

          let step = 0;
          while (true) {
            step += 1;

            const payload =
              step === 1
                ? {
                    chk: cab.chk,
                    zoom,
                    crop_size: crop,
                    image: dataUrl,
                    bearing,
                  } // prima iterazione → lat/lng dal DB
                : {
                    chk: cab.chk,
                    zoom,
                    crop_size: crop,
                    image: dataUrl,
                    bearing,
                    lat: target[0],
                    lng: target[1],
                  };

            let normJson;
            try {
              const resp = await fetchWithWatchdog(
                "http://localhost:8000/update_centered_coord",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                },
                60000
              );
              normJson = await resp.json();
              if (!resp.ok)
                throw new Error(normJson?.detail || `HTTP ${resp.status}`);
            } catch (err) {
              ui.setLogs((p) => [
                ...p,
                `❌ ${cab.chk}: normalizzazione fallita (${String(err)})`,
              ]);
              break;
            }

            const {
              new_lat,
              new_lng,
              done: doneServer,
              final_distance_px,
              density_score,
              message,
            } = normJson;

            // UI/log
            setArmonizedMarker({ lat: new_lat, lng: new_lng, chk: cab.chk });
            ui.setLogs((p) => [
              ...p,
              `• ${cab.chk} – norm step ${step}  dist:${Number(
                final_distance_px
              ).toFixed?.(1) ?? "?"}px  dens:${density_score ?? "?"}  ${
                message ?? ""
              }`,
            ]);

            // prossimo giro (se serve)
            target[0] = new_lat;
            target[1] = new_lng;

            const done =
              typeof doneServer === "boolean"
                ? doneServer
                : Number.isFinite(final_distance_px) && final_distance_px < 20;

            if (done) {
              if (map) {
                map.setView([new_lat, new_lng], 19, { animate: false });
                await waitForMapToSettle(map);
              }
              break;
            }
          }

          // 5) pulizia poligoni prima della cabina successiva
          setPolygonData(null);

          ui.setProgress(Math.round((i / total) * 100));
        }

        ui.setStatus("Finito");
      } finally {
        runningRef.current = false;
        hideCaptureUi(false);
        setHideMarkers(false);
      }
    },
    [mapRef, setCoords, setHideMarkers, setArmonizedMarker, setPolygonData, drawPolygons]
  );

  return { runBatch };
}
