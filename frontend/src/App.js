import React, { useState, useRef, useEffect } from "react";
import { MapContainer, TileLayer, useMap, Polygon, Tooltip, Marker, Popup } from "react-leaflet";
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
    map.on("zoomend", updateZoom);
    updateZoom(); // inizializza subito

    return () => {
      map.off("zoomend", updateZoom);
    };
  }, [map, setZoomLevel]);
  return null;
}

// -- SIDEBAR CONTROLS
function MapControls({
  lat, setLat, lng, setLng, idCabina, setIdCabina,
  setCoords, setPolygonData, setCaptureMode, capturedImage, setCapturedImage,
  analizzaCabina, isAnalisiLoading, centerCoords,
  captureParams
}) {
  const [error, setError] = useState("");

  const isCoordMode = lat !== "" || lng !== "";
  const isCabinaMode = idCabina !== "";

  const handleSubmit = async () => {
    setError("");

    if (isCoordMode && isCabinaMode) {
      setError("Inserisci solo coordinate o codice cabina, non entrambi.");
      return;
    }

    if (isCoordMode) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);

      if (isNaN(latNum) || isNaN(lngNum)) {
        setError("Latitudine o longitudine non valida.");
        return;
      }

      setCoords([latNum, lngNum]);
      setPolygonData(null);
      return;
    }

    if (isCabinaMode) {
      try {
        const res = await fetch(`http://localhost:8000/cabina/${idCabina}`);
        const data = await res.json();

        if (data.lat && data.lng) {
          setCoords([data.lat, data.lng]);
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
      return;
    }

    setError("Compila almeno un campo per la ricerca.");
  };

  return (
    <div className="sidebar">
      <h2>Dashboard</h2>
      <label>
        Latitudine:
        <input
          value={lat}
          onChange={e => setLat(e.target.value)}
          disabled={idCabina !== ""}
        />
      </label>
      <label>
        Longitudine:
        <input
          value={lng}
          onChange={e => setLng(e.target.value)}
          disabled={idCabina !== ""}
        />
      </label>
      <label>
        Codice cabina:
        <input
          value={idCabina}
          onChange={e => setIdCabina(e.target.value)}
          disabled={lat !== "" || lng !== ""}
        />
      </label>
      <button onClick={handleSubmit}>Vai</button>
      {error && <div style={{ color: "red", marginTop: "10px" }}>{error}</div>}
      <hr />
      <button
      onClick={async () => {
        // Se almeno un campo compilato, vai diretto
        if (lat !== "" || lng !== "" || idCabina !== "") {
          setCaptureMode(true);
          return;
        }
        // Nessun campo compilato: trova cabina vicino al centro
        try {
          const res = await fetch(`http://localhost:8000/cabina_near?lat=${centerCoords[0]}&lng=${centerCoords[1]}`);
          const data = await res.json();
          if (!data.lat || !data.lng || !data.chk) throw new Error("Nessuna cabina trovata vicino al centro mappa");
          setIdCabina(data.chk);
          setLat(data.lat.toString());
          setLng(data.lng.toString());
          setCaptureMode(true);
        } catch (e) {
          alert("Cabina non trovata vicino al centro");
        }
      }}
      style={{ marginTop: '10px', width: '100%' }}
    >
      📸 Scatta Foto
    </button>
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
        }}
      >
        ❌ Annulla analisi Immagine
      </button>
    </>
  )}

    </div>
  );
}

function SetView({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length === 2) {
      map.panTo(coords);  // Usa panTo per evitare zoom indesiderati
    }
  }, [coords, map]);
  return null;
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


function MapView({ coords, polygonData, cabine, mapRef, setCenterCoords, hideMarkers, setZoomLevel, zoomLevelForced }) {
    console.log("MapView polygonData:", polygonData);
  return (
    <MapContainer
        center={coords}
        rotate={true}
        touchRotate={true}
        zoom={6}
        className="rotatable-map"
        style={{ height: "100vh", width: "100%" }}
        whenReady={(mapInstance) => {
          mapRef.current = mapInstance.target;
          setZoomLevel(mapInstance.target.getZoom()); // <- aggiungi questa riga
      }}
    >
       <CenterTracker setCenterCoords={setCenterCoords} />
        <ZoomTracker setZoomLevel={setZoomLevel} />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics'
        maxZoom={22}
      />
      <SetView coords={coords}/>
      {!hideMarkers && (
        <MarkerClusterGroup>
          {cabine.map((cab, idx) => (
            <Marker key={idx} position={[cab.lat, cab.lng]} icon={blueIcon}>
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
      {polygonData && polygonData.map((poly, i) => {
          return (
            <Polygon
              key={i}
              positions={poly.points}
              color={poly.color || "#222"}
              fillColor={poly.color || "#222"}
              fillOpacity={0.45}
              weight={2}
            >
              <Tooltip sticky direction="top">
                <span style={{ fontWeight: 600 }}>{poly.label}</span>
                {poly.mq ? <><br />{poly.mq} mq</> : null}
              </Tooltip>
            </Polygon>
          );
        })}
    </MapContainer>
  );
}

function CenterShot({ onConfirm, onCancel, setHideMarkers, mapRef, centerCoords }) {
  const overlayRef = useRef(null);

  const handleShot = async () => {
    if (!overlayRef.current) return;
    const leafletElement = document.querySelector('.leaflet-container');

    overlayRef.current.style.display = 'none';
    setHideMarkers(true);

    const originalTransform = leafletElement.parentElement.style.transform;
    leafletElement.parentElement.style.transform = "none";

    await new Promise(r => setTimeout(r, 200));

    try {
      const fullCanvas = await html2canvas(leafletElement, {
        useCORS: true,
        backgroundColor: null,
        allowTaint: true,
        logging: false,
        scale: 1,
      });

      const cropSize = 300;
      const rect = leafletElement.getBoundingClientRect();
      const scaleFactor = fullCanvas.width / rect.width;
      const cx = (rect.width / 2 - cropSize / 2) * scaleFactor;
      const cy = (rect.height / 2 - cropSize / 2) * scaleFactor;

      const cropped = document.createElement('canvas');
      cropped.width = cropSize;
      cropped.height = cropSize;
      const ctx = cropped.getContext('2d');
      ctx.drawImage(fullCanvas, cx, cy, cropSize * scaleFactor, cropSize * scaleFactor, 0, 0, cropSize, cropSize);

      const dataUrl = cropped.toDataURL();
      const zoom = mapRef.current?.getZoom() ?? 19;
      const center = centerCoords || [0, 0];

      onConfirm(dataUrl, {
        crop_width: cropSize,
        crop_height: cropSize,
        zoom,
        zoomRef: zoom,
        centerLat: center[0],
        centerLng: center[1],
      });
    } finally {
      leafletElement.parentElement.style.transform = originalTransform;
      if (overlayRef.current) overlayRef.current.style.display = 'block';
      setHideMarkers(false);
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
        pointerEvents: 'none' // lascia passare drag/zoom alla mappa
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 300,
          height: 300,
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
          pointerEvents: 'auto' // i pulsanti restano cliccabili
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
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [idCabina, setIdCabina] = useState("");
  const [coords, setCoords] = useState([41.9028, 12.4964]);
  const [centerCoords, setCenterCoords] = useState([0, 0]);
  const [zoomLevel, setZoomLevel] = useState(6);
  const [polygonData, setPolygonData] = useState(null);
  const [cabine, setCabine] = useState([]);
  // const [autoZoom, setAutoZoom] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [captureParams, setCaptureParams] = useState(null);
  const [isAnalisiLoading, setIsAnalisiLoading] = useState(false);
  const mapRef = useRef(null);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
      if (mapRef.current) {
          mapRef.current.setBearing(rotation);
      }
  }, [rotation]);
  const [hideMarkers, setHideMarkers] = useState(false);

  useEffect(() => {
    fetch("http://localhost:8000/cabine")
      .then((res) => res.json())
      .then((data) => setCabine(data.data))
      .catch((err) => console.error("Errore nel fetch delle cabine:", err));
  }, []);

    // Funzione ANALISI
 async function analizzaCabina() {
  setIsAnalisiLoading(true);

  if (!capturedImage) {
    alert("Devi prima scattare una foto!");
    setIsAnalisiLoading(false);
    return;
  }

  try {
    const reqLat = centerCoords[0];
    const reqLng = centerCoords[1];

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

    console.log("Poligoni convertiti:", converted);

  } catch (e) {
    console.error("Errore durante l’analisi:", e);
    alert('Errore nell’analisi!');
  }

  setIsAnalisiLoading(false);
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
          capturedImage={capturedImage}
          setCapturedImage={setCapturedImage}
          analizzaCabina={analizzaCabina}
          isAnalisiLoading={isAnalisiLoading}
          centerCoords={centerCoords}
          captureParams={captureParams}
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
          cabine={cabine}
          // autoZoom={autoZoom}
          mapRef={mapRef}
          setCenterCoords={setCenterCoords}
          hideMarkers={hideMarkers}
          setZoomLevel={setZoomLevel}
        />
      </div>

      {/* CROCE ROSSA */}
      <div style={{
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
        <div style={{
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
      <div style={{
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
      <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 1000 }}>
         <button onClick={() => setRotation(r => r - 5)}>↺ Ruota -5°</button>
         <button onClick={() => setRotation(r => r + 5)}>↻ Ruota +5°</button>
         <button onClick={() => setRotation(0)}>⟳ Reset</button>
      </div>

      {/* BUSSOLA */}
      <div style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 1000 }}>
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

    </div>
  );
}

export default App;
