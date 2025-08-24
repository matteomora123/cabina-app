// src/batch/config.js
export const BATCH_SETTINGS = {
  targetZoom: 18.8,      // imposta 18.8 o 19
  cropSize: 500,         // lato crop px
  maxIter: 5,            // iter armonizzazione
  iterDelayMs: 200,      // pausa tra iter
  html2canvasScale: window.devicePixelRatio || 1
};
