// App.js

import React, { useState, useRef, useEffect } from "react";
import { MapContainer, TileLayer, useMap, Polygon, Tooltip, Marker, Popup, Pane } from "react-leaflet";
import BatchConsole from "./batch/BatchConsole";
import { useBatchRunner } from "./batch/useBatchRunner";
import "leaflet/dist/leaflet.css";
import "./App.css";
import MarkerClusterGroup from 'react-leaflet-markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import html2canvas from 'html2canvas';
import L from "leaflet";
import "leaflet-rotate";
import { useMapEvents } from "react-leaflet";
import { convertPolygonData } from './utils/geo.js';
const DRAW_POLYGONS_DURING_BATCH = true; // <--- toggle globale

const TIPO_OPTIONS = ["e-distribuzione", "CSAT", "Altri", "Convertito"];
const tipoFromRow = (row) => {
  const raw = row?.tipo_cabina;
  if (raw === null || raw === undefined || raw === "") return "e-distribuzione";
  return String(raw);
};

const CLEAN = (v) => (v === null || v === undefined || v === "" ? "[null]" : String(v));

// --- HELPERS PER CAPTURE ----------------------------------------------------
// Attende che la mappa sia "idle" senza usare proprietà private Leaflet
async function waitForMapToSettle(map, maxWaitMs = 800) {
  if (!map) return;

  // 1) dai un frame al layout
  await new Promise(r => requestAnimationFrame(r));

  // 2) aspetta il primo moveend/zoomend SE arriva, altrimenti sblocca con timeout
  await new Promise(res => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("moveend", finish);
      map.off("zoomend", finish);
      res();
    };
    const t = setTimeout(finish, maxWaitMs);
    map.once("moveend", () => { clearTimeout(t); finish(); });
    map.once("zoomend", () => { clearTimeout(t); finish(); });

    // 3) fallback extra: se non succede nulla, rilascia comunque dopo 2 frame
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(t);
      finish();
    }));
  });
}

// Attende che tutte le tile visibili siano caricate (img.complete && naturalWidth>0)
async function waitForTilesComplete(container, timeoutMs = 4000) {
  const start = performance.now();
  while (true) {
    const tiles = Array.from(container.querySelectorAll('img.leaflet-tile'));
    const allOk = tiles.length > 0 && tiles.every(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    if (allOk) return;
    if (performance.now() - start > timeoutMs) return;
    await new Promise(r => requestAnimationFrame(r));
  }
}

// Cattura robusta + crop centrale, con attese su mappa e tile
// Cattura robusta + crop centrale, con attese configurabili (e JPEG)
async function snapshotMapCrop(
  leafletElement,
  map,
  cropSize = 500,
  { tilesTimeoutMs = 0, settleMs = 250, mime = "image/jpeg", quality = 0.9 } = {}
) {
  await new Promise(r => requestAnimationFrame(r));      // 1 frame
  await waitForMapToSettle(map, settleMs);               // mappa quasi-idle
  if (tilesTimeoutMs > 0) {
    await waitForTilesComplete(leafletElement, tilesTimeoutMs);  // attesa tile breve
  }
  await new Promise(r => requestAnimationFrame(r));      // paint finale

  const fullCanvas = await html2canvas(leafletElement, {
    useCORS: true,
    backgroundColor: null,
    logging: false,
    scale: 1
  });

  const rect = leafletElement.getBoundingClientRect();
  const scaleFactor = fullCanvas.width / rect.width;
  const cx = (rect.width / 2 - cropSize / 2) * scaleFactor;
  const cy = (rect.height / 2 - cropSize / 2) * scaleFactor;

  const cropped = document.createElement("canvas");
  cropped.width = cropSize;
  cropped.height = cropSize;
  const ctx = cropped.getContext("2d");
  ctx.drawImage(
    fullCanvas,
    cx, cy,
    cropSize * scaleFactor, cropSize * scaleFactor,
    0, 0,
    cropSize, cropSize
  );

  // JPEG più veloce/leggero del PNG
  return cropped.toDataURL(mime, quality);
}

function toggleCaptureUiHidden(hide) {
  document.querySelectorAll('.capture-hide').forEach((el) => {
    if (hide) {
      el.setAttribute('data-prev-visibility', el.style.visibility || '');
      el.style.visibility = 'hidden';
    } else {
      el.style.visibility = el.getAttribute('data-prev-visibility') || '';
      el.removeAttribute('data-prev-visibility');
    }
  });
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}

// -- ICON
const blueIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function CenterTracker({ setCenterCoords }) {
  const map = useMapEvents({
    move: () => {
      const c = map.getCenter();
      setCenterCoords([c.lat.toFixed(6), c.lng.toFixed(6)]);
    },
  });

  useEffect(() => {
    const c = map.getCenter();
    setCenterCoords([c.lat.toFixed(6), c.lng.toFixed(6)]);
  }, [map, setCenterCoords]);

  return null;
}

function ZoomTracker({ setZoomLevel }) {
  const map = useMap();
  useEffect(() => {
      const updateZoom = () => setZoomLevel(map.getZoom());
      map.on("zoom", updateZoom);
      map.on("zoomend", updateZoom);
      updateZoom(); // inizializza subito
      return () => {
        map.off("zoom", updateZoom);
        map.off("zoomend", updateZoom);
      };
    }, [map, setZoomLevel]);
  return null;
}

function BoundsTracker({ setMapBounds }) {
  const map = useMap();
  useEffect(() => {
    const update = () => setMapBounds(map.getBounds());
    update(); // iniziale
    map.on('moveend zoomend', update);
    return () => {
      map.off('moveend zoomend', update);
    };
  }, [map, setMapBounds]);
  return null;
}


// -- SIDEBAR CONTROLS
function MapControls({
  lat, setLat, lng, setLng, idCabina, setIdCabina,
  setCoords, setPolygonData, setCaptureMode, capturedImage, setCapturedImage,
  setArmonizedMarker, analizzaCabina, isAnalisiLoading, centerCoords,
  captureParams, armonizzaCabinaAuto, mapRef, setPendingFlyTo, setZoomLevel,
  // filtri
  optionsTipoCabina, optionsAreaRegionale, optionsRegione, optionsProvSuggerite,
  filtroTipoCabina, setFiltroTipoCabina, filtroArea, setFiltroArea,
  filtroRegione, setFiltroRegione, filtroProvincia, setFiltroProvincia,
  soloInVista, setSoloInVista, conteggioFiltrate,
  selectedFromMarker, setSelectedFromMarker,
  runBatchSelection,                                    // <--- nuovo
}) {
  const [error, setError] = useState("");
  const [uiMsg, setUiMsg] = useState("");
  function resetAllFieldsIfLocked() {
  // Se almeno un campo è oscurato/bloccato, svuota tutto
  if (idCabina !== "" || lat !== "" || lng !== "") {
        setLat("");
        setLng("");
        setIdCabina("");
      }
    }
  const isCoordMode = lat !== "" || lng !== "";
  const isCabinaMode = idCabina !== "";

  const handleSubmit = async () => {
      setError("");

      if (!lat && !lng && !idCabina) {
        setError("Inserisci coordinate o codice cabina oppure clicca un marker.");
        return;
      }

      if (lat || lng) {
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        if (isNaN(latNum) || isNaN(lngNum)) {
          setError("Latitudine o longitudine non valida.");
          return;
        }
        setPendingFlyTo({ coords: [latNum, lngNum], zoom: 18 });
        setPolygonData(null);
        return;
      }

      try {
        const res = await fetch(`http://localhost:8000/cabina/${idCabina}`);
        const data = await res.json();
        if (data.lat && data.lng) {
          setPendingFlyTo({ coords: [data.lat, data.lng], zoom: 18 });
          setLat(data.lat.toString());
          setLng(data.lng.toString());
          setPolygonData(null);
        } else {
          setError("Cabina non trovata.");
        }
      } catch (err) {
        console.error("Errore API:", err);
        setError("Errore nella comunicazione con il server.");
      }
    };

      // PULISCI = azzera TUTTO (tipi, area, regione, provincia) + campi puntuali
    const handlePulisci = () => {
      setFiltroTipoCabina(new Set());
      setFiltroArea("");
      setFiltroRegione("");
      setFiltroProvincia("");

      // pulisco anche i campi puntuali
      setLat("");
      setLng("");
      setIdCabina("");
      setSelectedFromMarker(false);
      setUiMsg("");
    };

    // RESET FILTRI = NON tocca i tipi; azzera solo area/regione/provincia + campi puntuali
    const handleResetFiltri = () => {
      setFiltroArea("");
      setFiltroRegione("");
      setFiltroProvincia("");

      // pulisco anche i campi puntuali
      setLat("");
      setLng("");
      setIdCabina("");

      setSelectedFromMarker(false);
      setUiMsg("");
    };


  return (
    <div className="sidebar">
      <h2>Dashboard</h2>

              {/* === FILTRI MARKER === */}
        <div style={{margin: '12px 0', padding: 10, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
            <strong>Filtri marker</strong>
            <span style={{fontSize:12, opacity:0.8}}>in vista: {conteggioFiltrate}</span>
          </div>

          {/* Solo in vista */}
          <label style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}>
            <input
              type="checkbox"
              checked={!!soloInVista}
              onChange={e => setSoloInVista(e.target.checked)}
            />
            Mostra solo cabine nell’area visibile
          </label>

          {/* Tipo cabina (checkbox multiple) */}
          <div style={{marginBottom: 10}}>
            <div style={{fontSize:12, marginBottom:6}}>Tipo cabina</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:6}}>
              {optionsTipoCabina.map(opt => (
                <label key={opt} style={{display:'flex', alignItems:'center', gap:6}}>
                  <input
                    type="checkbox"
                    checked={filtroTipoCabina.has(opt)}
                    onChange={(e) => {
                      const next = new Set([...filtroTipoCabina]);
                      if (e.target.checked) next.add(opt);
                      else next.delete(opt);
                      setFiltroTipoCabina(next);
                    }}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <div style={{marginTop:6}}>
              <button
                type="button"
                onClick={() => setFiltroTipoCabina(new Set(optionsTipoCabina))}
                style={{marginRight:8}}
              >
                Seleziona tutti
              </button>

              <button
                type="button"
                onClick={handlePulisci}
              >
                Pulisci
              </button>
            </div>
        </div>

          {/* Area regionale (select) */}
          <div style={{marginBottom: 10}}>
            <div style={{fontSize:12, marginBottom:6}}>Area regionale</div>
            <select
              value={filtroArea}
              onChange={e => {
                setFiltroArea(e.target.value);
                // reset dipendenti
                setFiltroRegione("");
                setFiltroProvincia("");
              }}
              style={{width:'100%'}}
            >
              <option value="">(tutte)</option>
              {optionsAreaRegionale.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Regione (select dipendente da Area) */}
          <div style={{marginBottom: 10}}>
            <div style={{fontSize:12, marginBottom:6}}>Regione</div>
            <select
              value={filtroRegione}
              onChange={e => {
                setFiltroRegione(e.target.value);
                setFiltroProvincia("");
              }}
              style={{width:'100%'}}
              disabled={(!filtroArea) || optionsRegione.length === 0}
            >
              <option value="">(tutte)</option>
              {optionsRegione.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Provincia (input 2 lettere con suggerimenti) */}
          <div style={{marginBottom: 4}}>
            <div style={{fontSize:12, marginBottom:6}}>Provincia (2 lettere)</div>
            <input
              value={filtroProvincia}
              onChange={e => setFiltroProvincia(e.target.value.toUpperCase().slice(0, 2))}
              list="prov-suggestions"
              placeholder="es. RM"
              style={{width:'100%'}}
            />
            <datalist id="prov-suggestions">
              {optionsProvSuggerite.map(p => (
                <option key={p} value={p} />
              ))}
            </datalist>
              {filtroProvincia.length === 2 && optionsProvSuggerite.length === 0 && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#b91c1c' }}>
                Provincia non presente
              </div>
            )}
          </div>

          <div style={{display:'flex', gap:8, marginTop:8}}>
            <button type="button" onClick={handleResetFiltri}>
                Reset filtri
            </button>
            </div>
        </div>

      <style>{`
          input[disabled] {
            pointer-events: none;
          }
        `}</style>

        <div style={{ width: "100%", marginBottom: 8 }}>
          <span
            onClick={() => {
              if (idCabina !== "" || lat !== "" || lng !== "") {
                setLat("");
                setLng("");
                setIdCabina("");
                setSelectedFromMarker(false);
              }
            }}
            style={{ display: 'block', width: "100%", marginBottom: 4, cursor: 'pointer' }}
          >
            <label>Latitudine:</label>
            <input
              value={lat}
              onChange={e => { setLat(e.target.value); setSelectedFromMarker(false); }}
              disabled={idCabina !== ""}
              style={{ width: "95%" }}
            />
          </span>
          <span
            onClick={() => {
              if (idCabina !== "" || lat !== "" || lng !== "") {
                setLat("");
                setLng("");
                setIdCabina("");
                setSelectedFromMarker(false);
              }
            }}
            style={{ display: 'block', width: "100%", marginBottom: 4, cursor: 'pointer' }}
          >
            <label>Longitudine:</label>
            <input
              value={lng}
              onChange={e => { setLng(e.target.value); setSelectedFromMarker(false); }}
              disabled={idCabina !== ""}
              style={{ width: "95%" }}
            />
          </span>
          <span
            onClick={() => {
              if (lat !== "" || lng !== "") {
                setLat("");
                setLng("");
                setIdCabina("");
                setSelectedFromMarker(false);
              }
            }}
            style={{ display: 'block', width: "100%", marginBottom: 4, cursor: 'pointer' }}
          >
            <label>Codice cabina:</label>
            <input
              value={idCabina}
              onChange={e => { setIdCabina(e.target.value); setSelectedFromMarker(false); }}
              disabled={lat !== "" || lng !== ""}
              style={{ width: "95%" }}
            />
          </span>
        </div>

        <button onClick={handleSubmit} style={{ width: '100%', marginBottom: 12 }}>Vai</button>
        {/* === Estrazione aggregata === */}
        <div style={{margin:'12px 0', padding:10, border:'1px solid #ddd', borderRadius:8, background:'#fafafa'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <strong>Estrazione aggregata</strong>
            <span style={{fontSize:12, opacity:0.8}}>in vista: {conteggioFiltrate}</span>
          </div>

          <button
            onClick={() => {
              if (!conteggioFiltrate) return;
              const ok = window.confirm(
                `Confermi l’estrazione per la selezione aggregata corrente?\nCabine in vista: ${conteggioFiltrate}.`
              );
              if (!ok) return;
              runBatchSelection();
            }}
            disabled={!conteggioFiltrate}
            style={{
              width:'100%',
              background:'#111827', color:'#fff',
              border:'none', borderRadius:6, padding:8,
              cursor: conteggioFiltrate ? 'pointer' : 'not-allowed',
              opacity: conteggioFiltrate ? 1 : 0.5
            }}
          >
            Analizza selezione (batch)
          </button>

          <div style={{marginTop:6, fontSize:12, color:'#6b7280'}}>
            Avvia la segmentazione su tutte le cabine attualmente selezionate e genera l’Excel con le aree.
          </div>
        </div>

      {error && <div style={{ color: "red", marginTop: "10px" }}>{error}</div>}
      <hr />
      <button
          onClick={() => {
            if (!selectedFromMarker) { setUiMsg("Selezionare una cabina"); return; }
            setUiMsg("");
            setCaptureMode(true);
          }}
          disabled={!selectedFromMarker}
          style={{ marginTop: '10px', width: '100%', opacity: selectedFromMarker ? 1 : 0.5, cursor: selectedFromMarker ? 'pointer' : 'not-allowed' }}
        >
          📸 Scatta Foto
      </button>
        <button
              onClick={() => {
                if (!selectedFromMarker) { setUiMsg("Selezionare una cabina"); return; }
                setUiMsg("");
                armonizzaCabinaAuto();
              }}
              disabled={!selectedFromMarker}
              style={{
                marginTop: '10px',
                width: '100%',
                background: '#10b981',
                color: '#fff',
                fontWeight: 'bold',
                border: 'none',
                borderRadius: 5,
                padding: 8,
                opacity: selectedFromMarker ? 1 : 0.5,
                cursor: selectedFromMarker ? 'pointer' : 'not-allowed'
              }}
            >
              📍 Armonizza Cabina
        </button>
        {!capturedImage && uiMsg && (
          <div style={{ color: '#b91c1c', marginTop: 8 }}>
            {uiMsg}
          </div>
        )}

      {capturedImage && (
          <div style={{
            marginTop: '20px',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontFamily: 'sans-serif'
          }}>
            <h3 style={{ marginTop: 0 }}>Immagine scattata</h3>
            <img
              src={capturedImage}
              alt="Cattura"
              style={{
                width: '100%',
                borderRadius: '4px',
                border: '1px solid #999'
              }}
            />
          </div>
        )}
        {capturedImage && (
    <>
      <button
          style={{
            marginTop: 10,
            width: '100%',
            background: '#0070f3',
            color: '#fff',
            fontWeight: 'bold',
            border: 'none',
            borderRadius: 5,
            padding: 8
          }}
          onClick={analizzaCabina}
          disabled={isAnalisiLoading || !capturedImage || !captureParams}
        >
          {isAnalisiLoading ? "Analisi in corso..." : "Analizza Cabina"}
        </button>
      <button
        style={{
          marginTop: 14,
          width: '100%',
          background: '#ef4444',
          color: '#fff',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: 5,
          padding: 10,
          fontSize: 18,
          cursor: 'pointer'
        }}
        onClick={() => {
          setPolygonData(null);
          setLat("");
          setLng("");
          setIdCabina("");
          setCapturedImage(null);
          setSelectedFromMarker(false);
          setUiMsg("");
        }}
      >
        ❌ Annulla analisi Immagine
      </button>
    </>
  )}

    </div>
  );
}

function rotatePolygonCoords(points, map, angleDeg) {
    if (!Array.isArray(points) || !points.length) return points;

    const center = map.getCenter();
    const angleRad = (angleDeg * Math.PI) / 180;

    return points.map(([lat, lng]) => {
        const projected = map.project([lat, lng], map.getZoom());
        const centerProjected = map.project(center, map.getZoom());

        const dx = projected.x - centerProjected.x;
        const dy = projected.y - centerProjected.y;

        const rotatedX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
        const rotatedY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

        return [centerProjected.x + rotatedX, centerProjected.y + rotatedY];
    });
}


function MapView({ coords, polygonData, cabine, mapRef, setCenterCoords, hideMarkers, armonizedMarker, setZoomLevel, setLat, setLng, setIdCabina, lat, lng, idCabina, setMapBounds, filtroArea, fetchSeq, setSelectedFromMarker }) {

    console.log("MapView polygonData:", polygonData);
  return (
        <MapContainer
          center={coords}
          rotate={true}
          touchRotate={true}
          zoom={6}
          zoomAnimation={false}
          fadeAnimation={false}
          markerZoomAnimation={false}
          zoomSnap={0.1}
          zoomDelta={0.1}
          wheelPxPerZoomLevel={80}
          className="rotatable-map"
          style={{ height: "100vh", width: "100%" }}
          whenReady={(mapInstance) => {
            mapRef.current = mapInstance.target;
            setZoomLevel(mapInstance.target.getZoom());
          }}
        >
        <Pane name="underlay" style={{ zIndex: 390 }} />
        <Pane name="overlay"  style={{ zIndex: 410 }} />
       <CenterTracker setCenterCoords={setCenterCoords} />
        <ZoomTracker setZoomLevel={setZoomLevel} />
        <BoundsTracker setMapBounds={setMapBounds} />
      <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          crossOrigin="anonymous"
          attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics'
          maxZoom={22}
          keepBuffer={2}        // mantiene i vecchi tile mentre carica i nuovi
          updateWhenIdle={true} // aggiorna meno durante pan/zoom (meno fade)
         />


      {!hideMarkers && (
        <MarkerClusterGroup key={`${filtroArea || 'ALL'}|${fetchSeq}`}>
          {cabine.map((cab, idx) => (
            <Marker
              key={cab.chk || `${cab.lat},${cab.lng}`}
              position={[cab.lat, cab.lng]}
              icon={blueIcon}
              eventHandlers={{
                  click: () => {
                    setLat(cab.lat.toString());
                    setLng(cab.lng.toString());
                    setIdCabina(cab.chk);
                    setSelectedFromMarker(true);
                  }
                }}
            >
              <Popup>
                <strong>{cab.denom}</strong><br />
                CHK: {cab.chk}<br />
                Lat: {cab.lat.toFixed(6)}<br />
                Lng: {cab.lng.toFixed(6)}
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}
        {/* Marker verde per nuova coordinata armonizzata */}
        {!hideMarkers && armonizedMarker && (
              <Marker
                position={[armonizedMarker.lat, armonizedMarker.lng]}
                icon={new L.Icon({
                  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
                  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
                  iconSize: [25, 41],
                  iconAnchor: [12, 41],
                  popupAnchor: [1, -34],
                  shadowSize: [41, 41],
                })}
                eventHandlers={{
                  click: () => {
                    setLat(armonizedMarker.lat.toString());
                    setLng(armonizedMarker.lng.toString());
                    setIdCabina(armonizedMarker.chk);
                    setSelectedFromMarker(true);
                  }
                }}
              >
                <Popup>
                  <strong>Nuova posizione armonizzata</strong><br />
                  CHK: {armonizedMarker.chk}<br />
                  Lat: {armonizedMarker.lat.toFixed(6)}<br />
                  Lng: {armonizedMarker.lng.toFixed(6)}
                </Popup>
              </Marker>
            )}
       {polygonData && (() => {
          // ordina per area crescente → piccoli sopra
          const sortedPolys = [...polygonData].sort((a, b) => {
            const amq = Number.isFinite(a.mq) ? a.mq : Number.MAX_VALUE;
            const bmq = Number.isFinite(b.mq) ? b.mq : Number.MAX_VALUE;
            return amq - bmq;
          });
          return sortedPolys.map((poly, i) => (
            <Polygon
              key={i}
              positions={poly.points}
              color={poly.color}           // usa il colore originale
              fillColor={poly.color}       // idem
              fillOpacity={poly.mq > 5000 ? 0.2 : 0.45} // grandi più trasparenti
              weight={2}
              eventHandlers={{
                mouseover: (e) => e.target.bringToFront(),
              }}
            >
              <Tooltip sticky direction="top">
                <span style={{ fontWeight: 600 }}>{poly.label}</span>
                {Number.isFinite(poly.mq) ? (<><br />{poly.mq} mq</>) : null}
              </Tooltip>
            </Polygon>
          ));
        })()}
            </MapContainer>
  );
}

function CenterShot({ onConfirm, onCancel, setHideMarkers, mapRef, centerCoords }) {
  const overlayRef = useRef(null);

  const handleShot = async () => {
  if (!overlayRef.current) return;
  const leafletElement = document.querySelector(".leaflet-container");
  const map = mapRef.current;

  try {
        // nascondi overlay/UI
    overlayRef.current.style.visibility = "hidden";
    setHideMarkers(true);
    toggleCaptureUiHidden(true);

    // un frame al layout; NIENTE waitForMapToSettle / waitForTilesComplete qui
    await new Promise(r => requestAnimationFrame(r));

    const cropSize = 500;
    const dataUrl = await snapshotMapCrop(leafletElement, map, cropSize, {
      tilesTimeoutMs: 800,  // più tollerante per lo scatto manuale
      settleMs: 250,
      mime: "image/jpeg",
      quality: 0.9
    });

    const zoom = map?.getZoom() ?? 19;
    const center = centerCoords || [0, 0];

    onConfirm(dataUrl, {
      crop_width: cropSize,
      crop_height: cropSize,
      zoom,
      zoomRef: zoom,
      centerLat: center[0],
      centerLng: center[1],
      bearing: map?.getBearing?.() ?? 0
    });
  } finally {
    toggleCaptureUiHidden(false);
    setHideMarkers(false);
    overlayRef.current.style.visibility = "visible";
    await new Promise(r => requestAnimationFrame(r));
    mapRef.current?.invalidateSize(false);
  }
};

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 999,
        backgroundColor: 'rgba(0,0,0,0.35)',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 500,
          height: 500,
          transform: 'translate(-50%, -50%)',
          boxSizing: 'border-box',
          border: '3px solid #16a34a',
          background: 'rgba(22,163,74,0.06)',
          pointerEvents: 'none'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '65%',
          transform: 'translate(-50%, 0)',
          zIndex: 2000,
          background: 'rgba(255,255,255,0.95)',
          padding: '28px 20px 16px 20px',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexDirection: 'column',
          minWidth: 260,
          pointerEvents: 'auto'
        }}
      >
        <button
          onClick={handleShot}
          style={{
            background: '#16a34a',
            color: '#fff',
            fontWeight: 700,
            fontSize: 18,
            padding: '10px 28px',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer'
          }}
        >
          ✅ Scatta
        </button>
        <button
          onClick={onCancel}
          style={{
            background: '#f87171',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            padding: '8px 20px',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer'
          }}
        >
          ❌ Annulla
        </button>
      </div>
    </div>
  );
}


function App() {
  // --- TUTTI GLI STATE DEI CAMPI IN APP
  const [selectedFromMarker, setSelectedFromMarker] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [idCabina, setIdCabina] = useState("");
  const [coords, setCoords] = useState([41.9028, 12.4964]);
  const [centerCoords, setCenterCoords] = useState([0, 0]); // Roma
  const [zoomLevel, setZoomLevel] = useState(6);  // Zoom iniziale
  const [polygonData, setPolygonData] = useState(null);
  const [cabine, setCabine] = useState([]);
  const [armonizedMarker, setArmonizedMarker] = useState(null);
  // const [autoZoom, setAutoZoom] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [captureParams, setCaptureParams] = useState(null);
  const [isAnalisiLoading, setIsAnalisiLoading] = useState(false);
  const [pendingFlyTo, setPendingFlyTo] = useState(null); // [coords, zoom]
  const mapRef = useRef(null);
  const fetchSeqRef = useRef(0);
  const [rotation, setRotation] = useState(0);
  const [hideMarkers, setHideMarkers] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [consoleProgress, setConsoleProgress] = useState(0);
  const [consoleStatus, setConsoleStatus] = useState("");
  const batch = useBatchRunner({
  mapRef,
  setCoords,
  setHideMarkers,
  setArmonizedMarker,
  getCenterCoords: () => centerCoords,
  setPolygonData,
  drawPolygons: DRAW_POLYGONS_DURING_BATCH,

  // 👇 NUOVO: scatto veloce riusando snapshotMapCrop
  captureFrame: async () => {
    const map = mapRef.current;
    const el = document.querySelector(".leaflet-container");
    const cropSize = 500;

    const dataUrl = await snapshotMapCrop(el, map, cropSize, {
      tilesTimeoutMs: 250,   // breve
      settleMs: 200,         // breve
      mime: "image/jpeg",
      quality: 0.88
    });

    return {
      dataUrl,
      cropSize,
      zoom: map?.getZoom?.() ?? 18,
      bearing: map?.getBearing?.() ?? 0
    };
  }
});



  useEffect(() => {
      if (mapRef.current) {
          mapRef.current.setBearing(rotation);
      }
  }, [rotation]);

  // === FILTRI ===
  const [mapBounds, setMapBounds] = useState(null);
  const [soloInVista, setSoloInVista] = useState(true);
  const [filtroTipoCabina, setFiltroTipoCabina] = useState(new Set(["e-distribuzione"]));
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroRegione, setFiltroRegione] = useState("");
  const [filtroProvincia, setFiltroProvincia] = useState("");

  // Opzioni lato UI prese dal backend in base ai filtri selezionati

    const [optionsTipoCabina] = useState(TIPO_OPTIONS);
    const [optionsAreaRegionale, setOptionsAreaRegionale] = useState([]);
    const [optionsRegione, setOptionsRegione] = useState([]);
    const [optionsProvSuggerite, setOptionsProvSuggerite] = useState([]);

    // 1) Popola Aree in base ai TIPI selezionati
    // Carica cabine dal backend in base ai filtri (server-side filtering)
    // CHANGE: fetch cabine con abort, debounce, anti-race e no-cache
    // Carica SOLO per Area (semplice, niente altri parametri)
    // Carica cabine in base alla selezione progressiva
    // Reset gerarchico filtri
    useEffect(() => {
      setFiltroArea("");
      setFiltroRegione("");
      setFiltroProvincia("");
    }, [filtroTipoCabina]);

    useEffect(() => {
      setFiltroRegione("");
      setFiltroProvincia("");
    }, [filtroArea]);

    useEffect(() => {
      setFiltroProvincia("");
    }, [filtroRegione]);


    // Carica cabine in base alla selezione progressiva (area opzionale)
    // Carica cabine in base alla selezione progressiva
    useEffect(() => {
      const controller = new AbortController();
      const mySeq = ++fetchSeqRef.current;

      // Nessun tipo selezionato → svuota e stop
      if (filtroTipoCabina.size === 0) {
        setCabine([]);
        return;
      }

      setCabine([]); // pulizia immediata

      const url = new URL("http://localhost:8000/cabine");
      [...filtroTipoCabina].forEach(t => url.searchParams.append("tipo", t));
      if (filtroArea) url.searchParams.set("area_regionale", filtroArea);
      if (filtroRegione) url.searchParams.set("regione", filtroRegione);
      if (filtroProvincia && filtroProvincia.trim().length === 2) {
        url.searchParams.set("provincia", filtroProvincia.trim().toUpperCase());
      }

      fetch(url.toString(), { signal: controller.signal, cache: "no-store" })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
        .then(data => {
          if (mySeq !== fetchSeqRef.current) return;
          const rows = Array.isArray(data.data) ? data.data : [];
          const norm = rows.map(c => ({ ...c, lat: +c.lat, lng: +c.lng }))
                           .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
          setCabine(norm);
        })
        .catch(err => {
          if (err.name === "AbortError") return;
          if (mySeq !== fetchSeqRef.current) return;
          console.warn("fetch cabine", err);
          setCabine([]);
        });

      return () => controller.abort();
    }, [filtroTipoCabina, filtroArea, filtroRegione, filtroProvincia]);

    // --- CARICA AREE in base ai TIPI selezionati
    useEffect(() => {
      if (filtroTipoCabina.size === 0) {
        setOptionsAreaRegionale([]);
        setFiltroArea("");
        return;
      }
      const controller = new AbortController();
      const params = new URLSearchParams();
      [...filtroTipoCabina].forEach(t => params.append("tipo", t));

      fetch(`http://localhost:8000/filters/area_regionale?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store" // ADD
        })
        .then(r => r.json())
        .then(data => {
          const opts = data.options || [];
          setOptionsAreaRegionale(opts);
          if (filtroArea && !opts.includes(filtroArea)) setFiltroArea("");
        })
        .catch(() => {});
      return () => controller.abort();
    }, [filtroTipoCabina]);

    // --- CARICA REGIONI in base a TIPI + AREA
    useEffect(() => {
      if (filtroTipoCabina.size === 0) {
        setOptionsRegione([]);
        setFiltroRegione("");
        return;
      }
      const controller = new AbortController();
      const params = new URLSearchParams();
      [...filtroTipoCabina].forEach(t => params.append("tipo", t));
      if (filtroArea) params.set("area_regionale", filtroArea);  // <-- CORRETTO

      fetch(`http://localhost:8000/filters/regione?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store" // ADD
    })
        .then(r => r.json())
        .then(data => {
          const opts = data.options || [];
          setOptionsRegione(opts);
          if (filtroRegione && !opts.includes(filtroRegione)) setFiltroRegione("");
        })
        .catch(() => {});
      return () => controller.abort();
    }, [filtroTipoCabina, filtroArea]);

    // --- SUGGERIMENTI PROVINCE in base a TIPI + AREA + REGIONE + prefisso
    useEffect(() => {
      if (filtroTipoCabina.size === 0) {
        setOptionsProvSuggerite([]);
        return;
      }
      const controller = new AbortController();
      const t = setTimeout(() => {
        const params = new URLSearchParams();
        [...filtroTipoCabina].forEach(t => params.append("tipo", t));
        if (filtroArea) params.set("area_regionale", filtroArea); // <-- CORRETTO
        if (filtroRegione) params.set("regione", filtroRegione);
        if (filtroProvincia) params.set("q", filtroProvincia);

        fetch(`http://localhost:8000/filters/provincia?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store" // ADD
        })
          .then(r => r.json())
          .then(data => setOptionsProvSuggerite(data.options || []))
          .catch(() => {});
      }, 200);
      return () => { controller.abort(); clearTimeout(t); };
    }, [filtroTipoCabina, filtroArea, filtroRegione, filtroProvincia]);

    // Svuota i campi puntuali quando cambiano i filtri
    useEffect(() => {
      setLat("");
      setLng("");
      setIdCabina("");
      setSelectedFromMarker(false);
    }, [filtroTipoCabina, filtroArea, filtroRegione, filtroProvincia]);

    // Filtraggio cabine
    const cabineFiltrate = React.useMemo(() => {
          if (soloInVista && mapBounds) {
            return cabine.filter(c => {
              try { return mapBounds.contains(L.latLng(c.lat, c.lng)); }
              catch { return true; }
            });
          }
          return cabine;
        }, [cabine, soloInVista, mapBounds]);
    const conteggioFiltrate = cabineFiltrate.length;

    // Avvia il batch sulla selezione corrente (cabineFiltrate) aprendo la console
    const runBatchSelection = React.useCallback(() => {
      setConsoleOpen(true);
      batch.runBatch(cabineFiltrate, {
        setLogs: setConsoleLogs,
        setProgress: setConsoleProgress,
        setStatus: setConsoleStatus,
        setOpen: setConsoleOpen
      });
    }, [batch, cabineFiltrate, setConsoleOpen, setConsoleLogs, setConsoleProgress, setConsoleStatus]);

  useEffect(() => {
  if (mapRef.current && pendingFlyTo) {
    const { coords, zoom } = pendingFlyTo;
    mapRef.current.flyTo(coords, zoom, { animate: true, duration: 1.5 });
    setCoords(coords);
    setZoomLevel(zoom);
    setPendingFlyTo(null);
  }
}, [pendingFlyTo]);
  // Funzione ANALISI
 async function analizzaCabina() {
  setIsAnalisiLoading(true);

  if (!capturedImage) {
    alert("Devi prima scattare una foto!");
    setIsAnalisiLoading(false);
    return;
  }

  try {
    const reqLat = parseFloat(centerCoords[0]);
    const reqLng = parseFloat(centerCoords[1]);

    // Sposta la mappa e abilita lo zoom
    setCoords([reqLat, reqLng]);
    // setAutoZoom(false);

    // Chiamata al backend AI
    const res2 = await fetch('http://localhost:8000/segmenta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: capturedImage,
        lat: reqLat,
        lng: reqLng,
        crop_width: captureParams?.crop_width,
        crop_height: captureParams?.crop_height,
        zoom: captureParams?.zoom
      }),
    });

    const data2 = await res2.json();
    console.log("Risposta completa dal backend:", data2);

    /*const poligoniRuotati = data2.poligoni.map(data => {
        return {
            ...data,
            points: rotatePolygonCoords(data.points, mapRef.current, rotation)
        }
    })
    const poligoniFromBackend = rotation !== 0 ? poligoniRuotati : data2.poligoni;*/
    const poligoniFromBackend = data2.poligoni;

    if (!poligoniFromBackend) {
      alert("Errore backend AI: " + (data2.detail || "Risposta non valida!"));
      setIsAnalisiLoading(false);
      return;
    }
    const converted = convertPolygonData(poligoniFromBackend, captureParams);
    // Aspetta che la mappa abbia finito di centrarsi
    const map = mapRef.current;
    setPolygonData(converted); // fallback

    console.log("Poligoni convertito:", converted);

  } catch (e) {
    console.error("Errore durante l’analisi:", e);
    alert('Errore nell’analisi!');
  }

  setIsAnalisiLoading(false);
}

 async function armonizzaCabinaAuto() {
  if (!idCabina) { alert("Seleziona prima una cabina"); return; }

  let currentLat = parseFloat(lat);
  let currentLng = parseFloat(lng);
  const maxIter = 5;
  const cropSize = 500;
  const leafletElement = document.querySelector(".leaflet-container");
  const map = mapRef.current;

  for (let step = 1; step <= maxIter; step++) {
    try {
      // un frame al layout; niente attese lente qui
      await new Promise(r => requestAnimationFrame(r));

      // SCATTO "VELOCE" (attese interne ridotte + JPEG)
      const imageData = await snapshotMapCrop(leafletElement, map, cropSize, {
        tilesTimeoutMs: 250,   // invece di 4000ms
        settleMs: 200,
        mime: "image/jpeg",
        quality: 0.88
      });

      // chiamata backend
      const body = {
        chk: idCabina,
        zoom: map?.getZoom() ?? 18,
        crop_size: cropSize,
        image: imageData,
        bearing: map?.getBearing?.() ?? 0,
        ...(step > 1 ? { lat: currentLat, lng: currentLng } : {})
      };

      const resp = await fetch("http://localhost:8000/update_centered_coord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await resp.json();
      if (!resp.ok) {
        alert("Errore armonizzazione: " + (result.detail || "Errore sconosciuto"));
        break;
      }

      currentLat = result.new_lat;
      currentLng = result.new_lng;

      setArmonizedMarker({ lat: currentLat, lng: currentLng, chk: idCabina });
      setCoords([currentLat, currentLng]);

      // niente animazioni (evita altre attese)
      map?.setView([currentLat, currentLng], 18, { animate: false });

      if (result.done) break;

      // micro pausa
      await new Promise(r => setTimeout(r, 150));
    } finally {
      await new Promise(r => requestAnimationFrame(r));
      map?.invalidateSize(false);
    }
  }
}

  return (
    <div className="app" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* SIDEBAR SINISTRA */}
      <MapControls
          lat={lat} setLat={setLat}
          lng={lng} setLng={setLng}
          idCabina={idCabina} setIdCabina={setIdCabina}
          setCoords={(newCoords) => {
              setCoords(newCoords);
              // setAutoZoom(false); // ❌ niente zoom automatico
          }}
          setPolygonData={setPolygonData}
          setCaptureMode={setCaptureMode}
          mapRef={mapRef}
          capturedImage={capturedImage}
          setZoomLevel={setZoomLevel}
          setPendingFlyTo={setPendingFlyTo}
          setCapturedImage={setCapturedImage}
          setArmonizedMarker={setArmonizedMarker}
          armonizzaCabinaAuto={armonizzaCabinaAuto}
          analizzaCabina={analizzaCabina}
          isAnalisiLoading={isAnalisiLoading}
          centerCoords={centerCoords}
          captureParams={captureParams}
          optionsTipoCabina={optionsTipoCabina}
          optionsAreaRegionale={optionsAreaRegionale}
          optionsRegione={optionsRegione}
          optionsProvSuggerite={optionsProvSuggerite}
          filtroTipoCabina={filtroTipoCabina}
          setFiltroTipoCabina={setFiltroTipoCabina}
          filtroArea={filtroArea}
          setFiltroArea={setFiltroArea}
          filtroRegione={filtroRegione}
          setFiltroRegione={setFiltroRegione}
          filtroProvincia={filtroProvincia}
          setFiltroProvincia={setFiltroProvincia}
          soloInVista={soloInVista}
          setSoloInVista={setSoloInVista}
          conteggioFiltrate={conteggioFiltrate}
          selectedFromMarker={selectedFromMarker}
          setSelectedFromMarker={setSelectedFromMarker}
          runBatchSelection={runBatchSelection}
      />

      {/* MAPPA CENTRALE */}
      <div
        className="map-rotator"
        style={{
          width: '100%'
        }}
      >
        <MapView
          coords={coords}
          polygonData={polygonData}
          // autoZoom={autoZoom}
          mapRef={mapRef}
          setCenterCoords={setCenterCoords}
          armonizedMarker={armonizedMarker}
          hideMarkers={hideMarkers}
          setZoomLevel={setZoomLevel}
          setLat={setLat}
          setLng={setLng}
          setIdCabina={setIdCabina}
          lat={lat}
          lng={lng}
          cabine={cabineFiltrate}
          idCabina={idCabina}
          setMapBounds={setMapBounds}
          filtroArea={filtroArea}
          fetchSeq={fetchSeqRef.current}
          setSelectedFromMarker={setSelectedFromMarker}
        />
      </div>

      {/* CROCE ROSSA */}
      <div className="capture-hide" style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1002,
        pointerEvents: 'none'
      }}>
        <div style={{
          width: 20,
          height: 20,
          borderLeft: '2px solid red',
          borderTop: '2px solid red',
          transform: 'rotate(45deg)'
        }} />
      </div>
        {/* ZOOM LEVEL IN ALTO A SINISTRA */}
        <div className="capture-hide" style={{
          position: 'absolute',
          top: 10,
          left: 350,
          zIndex: 1000,
          background: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          boxShadow: '0 0 4px rgba(0,0,0,0.2)',
          fontSize: 14
        }}>
          <strong>Zoom:</strong> {zoomLevel}
        </div>
      {/* INFO LAT LNG */}
      <div className="capture-hide" style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1000,
        background: 'white',
        padding: 5
      }}>
        <strong>Lat:</strong> {centerCoords[0]}<br />
        <strong>Lng:</strong> {centerCoords[1]}
      </div>

      {/* ROTAZIONE */}
      <div className="capture-hide" style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 1000 }}>
         <button onClick={() => setRotation(r => r - 5)}>↺ Ruota -5°</button>
         <button onClick={() => setRotation(r => r + 5)}>↻ Ruota +5°</button>
         <button onClick={() => setRotation(0)}>⟳ Reset</button>
      </div>

      {/* BUSSOLA */}
      <div className="capture-hide" style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 1000 }}>
        <img
          src="/compass.png"
          alt="Bussola"
          style={{ width: 60, height: 60, transform: `rotate(${-rotation}deg)` }}
        />
      </div>

      {/* OVERLAY FOTO */}
      {captureMode && (
          <CenterShot
            mapRef={mapRef}
            centerCoords={centerCoords}
            onConfirm={(imgDataUrl, params) => {
              setCapturedImage(imgDataUrl);
              setCaptureParams(params);
              setCaptureMode(false);
            }}
            onCancel={() => setCaptureMode(false)}
            setHideMarkers={setHideMarkers}
          />
        )}
        <BatchConsole
          open={consoleOpen}
          onClose={() => setConsoleOpen(false)}
          progress={consoleProgress}
          status={consoleStatus}
          logs={consoleLogs}
        />
    </div>
  );
}

export default App;