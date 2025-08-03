# Architettura del progetto `cabina-app`

La directory è suddivisa in tre blocchi principali:

- `frontend/`
- `backend/`
- `segformer/`

---

## Frontend

Il frontend è sviluppato in **React** e utilizza **Leaflet** per la gestione della mappa.

Permette all'utente di:

- cercare cabine tramite coordinate o codice univoco (`CHK`);
- catturare un’immagine centrata sulla mappa (snapshot);
- inviare l’immagine al backend per l’elaborazione.

Il file `App.js` inizializza la mappa e gestisce lo stato dell’applicazione (coordinate, zoom, poligoni, immagine catturata).

I componenti principali sono:

- `MapControls` (input utente e interfaccia);
- `MapView` (mappa e marker);
- `CenterShot` (overlay cattura immagine).

Le funzioni di `utils/geo.js` convertono le coordinate pixel (relative alla snapshot) in lat/lng, in base a zoom e centro mappa, per rendere i poligoni compatibili con Leaflet.

---

## Backend

Il backend è un’API **FastAPI** che espone endpoint REST per:

- ottenere l’elenco delle cabine da un database **PostGIS**;
- recuperare una cabina tramite codice `CHK`;
- trovare la cabina più vicina a una posizione.

L’endpoint `/segmenta` riceve una richiesta dal frontend (immagine + metadati) e la inoltra al microservizio AI. In caso di indisponibilità del database, restituisce dati di fallback mockati.

---

## Microservizio AI

Il microservizio, contenuto in `ai_microservice/`, è una FastAPI separata.

Carica un modello **Segformer** fine-tuned localmente e riceve una immagine codificata in base64. L’immagine viene segmentata e viene restituito un array di poligoni in coordinate pixel.

Viene anche generata una maschera visuale (overlay) salvata su disco per scopi di debug.

La segmentazione utilizza classi definite in `CVAT_CLASSES`, ciascuna con label e colore specifico.

---

## Directory `segformer`

Contiene tutto il necessario per l’addestramento del modello AI:

- immagini originali;
- maschere;
- immagini aumentate;
- script di augmentation (`augment_images_and_masks.py`);
- conversione JSON → PNG;
- configurazioni;
- modello addestrato (`segformer_finetuned/`) con pesi e config compatibili HuggingFace.

---

## Flusso AI (pipeline)

1. Il frontend cattura una snapshot (HTML canvas) centrata sulla mappa.
2. L’immagine viene convertita in base64 e inviata al backend, con zoom, centro e dimensione crop.
3. Il backend inoltra la richiesta al microservizio AI.
4. Il microservizio:
   - decodifica e preprocessa l’immagine;
   - esegue inferenza con **Segformer**;
   - estrae i contorni di ogni classe segmentata (escluse le background);
   - costruisce poligoni per ciascuna zona individuata;
   - restituisce al backend un JSON con i dati.
5. Il backend gira i dati al frontend.
6. Il frontend converte i poligoni da coordinate locali (px) a coordinate geografiche (lat/lng), usando zoom e centro mappa salvati al momento dello scatto.
7. I poligoni vengono renderizzati in mappa.

---

## Schema del flusso (sintesi architetturale)

```text
+--------------------------+
|        FRONTEND         |
|--------------------------|
| - Mappa con marker      |
| - Cattura snapshot      |
| - Invio immagine        |
+-----------+--------------+
            |
            | Richiesta snapshot + dati (lat/lng, zoom)
            v
+--------------------------+
|         BACKEND         |
|--------------------------|
| - API REST FastAPI      |
| - Accesso DB PostGIS    |
| - Proxy verso AI        |
| - Fallback con dati fake|
+-----------+--------------+
            |
            | Inoltra immagine e metadati
            v
+--------------------------+
|     MICRO AI SERVICE    |
|--------------------------|
| - FastAPI isolato       |
| - Segformer fine-tuned  |
| - Segmentazione immagine|
| - Output: poligoni (px) |
+-----------+--------------+
            |
            | Ritorno poligoni (px)
            v
+--------------------------+
|        FRONTEND         |
|--------------------------|
| - Conversione px → lat/lng |
| - Visualizzazione poligoni |
+--------------------------+

+-----------------------------+
|   DIRECTORY TRAINING (AI)  |
|-----------------------------|
| - Dataset immagini/maschere|
| - Script di training        |
| - Modello fine-tuned       |
+-----------------------------+
