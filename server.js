'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { erstelleKinoprogramm } = require('./lib/kino');
const { holeWetter } = require('./lib/wetter');
const { erstelleAlbenliste } = require('./lib/musik');
const { heuteISO, morgenISO } = require('./lib/datum');

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 Minuten
const FEHLER_TTL_MS = 3 * 60 * 1000; // Lieferte kein Kino Filme, nach 3 Minuten erneut versuchen
const WETTER_TTL_MS = 15 * 60 * 1000; // Open-Meteo aktualisiert etwa viertelstündlich
const WETTER_FEHLER_TTL_MS = 60 * 1000; // Nach einem Fehlschlag zügig erneut versuchen
// Die Liste ändert sich einmal pro Woche. Häufiger als alle drei Stunden nachzusehen, brächte
// nichts - kostet aber jedes Mal einen Seitenabruf und bis zu 80 Cover-Suchen.
const ALBEN_TTL_MS = 3 * 60 * 60 * 1000;
const ALBEN_FEHLER_TTL_MS = 10 * 60 * 1000;
const DATENORDNER = path.join(__dirname, 'data');
const ALBEN_DATEI = path.join(DATENORDNER, 'alben.json');

// Nur diese beiden Tage sind über die API erreichbar. Ein freier Datumsparameter würde jeden
// Aufruf in einen Scrape-Auftrag gegen vier Fremdseiten verwandeln.
const ERLAUBTE_TAGE = { heute: heuteISO, morgen: morgenISO };

function cacheDatei(datum) {
  return path.join(DATENORDNER, `kino-${datum}.json`);
}

// ---------- Kino-Cache ----------

const kinoCache = new Map(); // datum -> { daten, geladenUm }
const laufendeScrapes = new Map(); // datum -> Promise, verhindert parallele Mehrfach-Scrapes

// Beim Start: bereits generierte Dateien für heute/morgen als warmen Cache übernehmen, damit der
// erste Seitenaufruf nach einem Server-Neustart nicht zwingend 20-30s warten muss. Alles, was
// weder heute noch morgen betrifft, ist Altlast und wird entfernt.
function ladeCacheVonPlatte() {
  const gueltig = new Set([heuteISO(), morgenISO()]);

  for (const datum of gueltig) {
    try {
      const bestehend = JSON.parse(fs.readFileSync(cacheDatei(datum), 'utf8'));
      if (bestehend && bestehend.datum === datum && (bestehend.kinos || []).some((k) => (k.filme || []).length > 0)) {
        kinoCache.set(datum, { daten: bestehend, geladenUm: Date.parse(bestehend.generiertAm) || Date.now() });
        console.log(`Bestehende Kinodaten für ${datum} als Cache übernommen.`);
      }
    } catch (e) {
      // keine oder unlesbare Datei -> beim ersten Request wird frisch geladen
    }
  }

  try {
    for (const name of fs.readdirSync(DATENORDNER)) {
      const treffer = name.match(/^kino-(\d{4}-\d{2}-\d{2})\.json$/);
      // kino.json ist der Dateiname aus der Zeit vor der Morgen-Vorschau und wird nicht mehr
      // geschrieben; er darf nicht als Karteileiche liegenbleiben.
      const veraltet = name === 'kino.json' || (treffer && !gueltig.has(treffer[1]));
      if (veraltet) fs.unlinkSync(path.join(DATENORDNER, name));
    }
  } catch (e) {
    // Ordner existiert noch nicht oder ist nicht lesbar - dann gibt es auch nichts aufzuräumen.
  }
}
ladeCacheVonPlatte();

async function holeKinoDaten(datum, erzwingen) {
  const zwischenstand = kinoCache.get(datum);
  if (!erzwingen && zwischenstand && Date.now() - zwischenstand.geladenUm < CACHE_TTL_MS) {
    return zwischenstand.daten;
  }

  if (!laufendeScrapes.has(datum)) {
    laufendeScrapes.set(
      datum,
      erstelleKinoprogramm(datum).finally(() => laufendeScrapes.delete(datum))
    );
  }
  const daten = await laufendeScrapes.get(datum);

  // Hat kein einziges Kino Filme geliefert, ist das mit hoher Wahrscheinlichkeit eine Störung
  // (Netzausfall, alle Seiten umgebaut) und kein spielfreier Tag. Solch ein Ergebnis darf weder
  // 45 Minuten im RAM festhängen noch den zuletzt brauchbaren Stand auf der Platte überschreiben.
  const brauchbar = daten.kinos.some((k) => k.filme.length > 0);
  if (!brauchbar) {
    console.warn(`Kein Kino lieferte Filme für ${datum} - Ergebnis wird nur kurz gecacht und nicht gespeichert.`);
    kinoCache.set(datum, { daten, geladenUm: Date.now() - CACHE_TTL_MS + FEHLER_TTL_MS });
    return daten;
  }

  kinoCache.set(datum, { daten, geladenUm: Date.now() });
  try {
    fs.mkdirSync(DATENORDNER, { recursive: true });
    fs.writeFileSync(cacheDatei(datum), JSON.stringify(daten, null, 2), 'utf8');
  } catch (e) {
    console.warn('Konnte Kino-Cache-Datei nicht schreiben:', e.message);
  }
  return daten;
}

// ---------- Wetter-Cache ----------

// Nur im RAM: eine Wettervorhersage von gestern ist wertlos, ein warmer Start bringt hier also
// nichts, und der Abruf dauert ohnehin nur Millisekunden.
let wetterCache = null; // { daten, geladenUm }
let laufenderWetterAbruf = null;

async function holeWetterDaten(erzwingen) {
  if (!erzwingen && wetterCache && Date.now() - wetterCache.geladenUm < WETTER_TTL_MS) {
    return wetterCache.daten;
  }
  if (!laufenderWetterAbruf) {
    laufenderWetterAbruf = holeWetter().finally(() => {
      laufenderWetterAbruf = null;
    });
  }
  try {
    const daten = await laufenderWetterAbruf;
    wetterCache = { daten, geladenUm: Date.now() };
    return daten;
  } catch (err) {
    // Scheitert der Abruf, bleibt der letzte brauchbare Stand stehen - eine kurz gestörte
    // Internetverbindung soll die Kachel nicht leeren. Der Client erkennt am Alter, wie frisch
    // die Daten sind.
    if (wetterCache) {
      wetterCache.geladenUm = Date.now() - WETTER_TTL_MS + WETTER_FEHLER_TTL_MS;
      console.warn('Wetterabruf fehlgeschlagen, liefere letzten Stand:', err.message);
      return wetterCache.daten;
    }
    throw err;
  }
}

// ---------- Alben-Cache ----------

// Anders als beim Wetter lohnt der warme Start: die Wochenliste ist auch nach einem Neustart
// noch gültig, und ihr Aufbau kostet einen Seitenabruf plus eine Cover-Suche je Album.
let albenCache = null; // { daten, geladenUm }
let laufenderAlbenAbruf = null;

function ladeAlbenVonPlatte() {
  try {
    const bestehend = JSON.parse(fs.readFileSync(ALBEN_DATEI, 'utf8'));
    if (bestehend && Array.isArray(bestehend.alben) && bestehend.alben.length > 0) {
      albenCache = { daten: bestehend, geladenUm: Date.parse(bestehend.generiertAm) || 0 };
      console.log(`Bestehende Albenliste vom ${bestehend.datum} als Cache übernommen.`);
    }
  } catch (e) {
    // keine oder unlesbare Datei -> beim ersten Request wird frisch geladen
  }
}
ladeAlbenVonPlatte();

async function holeAlbenDaten(erzwingen) {
  if (!erzwingen && albenCache && Date.now() - albenCache.geladenUm < ALBEN_TTL_MS) {
    return albenCache.daten;
  }
  if (!laufenderAlbenAbruf) {
    laufenderAlbenAbruf = erstelleAlbenliste().finally(() => {
      laufenderAlbenAbruf = null;
    });
  }

  try {
    const daten = await laufenderAlbenAbruf;
    albenCache = { daten, geladenUm: Date.now() };
    try {
      fs.mkdirSync(DATENORDNER, { recursive: true });
      fs.writeFileSync(ALBEN_DATEI, JSON.stringify(daten, null, 2), 'utf8');
    } catch (e) {
      console.warn('Konnte Albenliste nicht speichern:', e.message);
    }
    return daten;
  } catch (err) {
    // Wie beim Wetter: eine Störung leert die Kachel nicht. Die Liste wird mit dem Fehler
    // ausgeliefert, damit das Frontend sagen kann, warum der Stand nicht frisch ist.
    if (albenCache) {
      albenCache.geladenUm = Date.now() - ALBEN_TTL_MS + ALBEN_FEHLER_TTL_MS;
      console.warn('Albenabruf fehlgeschlagen, liefere letzten Stand:', err.message);
      return Object.assign({}, albenCache.daten, { fehler: err.message });
    }
    throw err;
  }
}

// ---------- Statische Auslieferung ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Nur ausdrücklich freigegebene Dateien werden ausgeliefert. Vorher lieferte der Handler jede
// Datei im App-Ordner aus - auch .git/config, den Quellcode und node_modules. Neue Assets
// müssen hier eingetragen werden.
const OEFFENTLICHE_DATEIEN = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.css', 'app.css'],
  ['/app.js', 'app.js'],
]);

function sendeJson(res, status, objekt) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(objekt));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/kino') {
    const tag = url.searchParams.get('tag') || 'heute';
    if (!Object.prototype.hasOwnProperty.call(ERLAUBTE_TAGE, tag)) {
      sendeJson(res, 400, { fehler: `Unbekannter Tag "${tag}" - erlaubt sind heute und morgen.` });
      return;
    }
    try {
      const daten = await holeKinoDaten(ERLAUBTE_TAGE[tag](), url.searchParams.get('refresh') === '1');
      sendeJson(res, 200, daten);
    } catch (err) {
      // Absicherung, kein Regelfall: erstelleKinoprogramm() fängt Fehler pro Kino ab und wirft
      // normalerweise nicht. Greift dieser Zweig, ist etwas Unerwartetes passiert (z.B. defekte
      // Intl-Daten) - dann ist eine saubere 502 besser als ein Absturz des Request-Handlers.
      console.error('Unerwarteter Fehler in /api/kino:', err);
      sendeJson(res, 502, { fehler: err.message });
    }
    return;
  }

  if (url.pathname === '/api/wetter') {
    try {
      const daten = await holeWetterDaten(url.searchParams.get('refresh') === '1');
      sendeJson(res, 200, daten);
    } catch (err) {
      console.error('Wetterabruf fehlgeschlagen:', err.message);
      sendeJson(res, 502, { fehler: err.message });
    }
    return;
  }

  if (url.pathname === '/api/alben') {
    try {
      const daten = await holeAlbenDaten(url.searchParams.get('refresh') === '1');
      sendeJson(res, 200, daten);
    } catch (err) {
      console.error('Albenabruf fehlgeschlagen:', err.message);
      sendeJson(res, 502, { fehler: err.message });
    }
    return;
  }

  const freigegeben = OEFFENTLICHE_DATEIEN.get(url.pathname);
  if (!freigegeben) {
    res.writeHead(404);
    res.end('Nicht gefunden');
    return;
  }
  const dateiPfad = path.join(__dirname, freigegeben);

  fs.readFile(dateiPfad, (err, inhalt) => {
    if (err) {
      res.writeHead(404);
      res.end('Nicht gefunden');
      return;
    }
    const ext = path.extname(dateiPfad);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(inhalt);
  });
});

server.listen(PORT, () => {
  console.log(`Homeboard läuft auf http://localhost:${server.address().port}`);
});

// docker stop schickt SIGTERM und wartet 10 Sekunden, bevor hart gekillt wird. Ohne Handler
// bricht Node laufende Anfragen mittendrin ab.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} empfangen - Server wird beendet.`);
    server.close(() => process.exit(0));
    // Falls sich eine Verbindung nicht schließen lässt, trotzdem beenden.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

// Damit die Smoke-Tests den Server auf einem freien Port (PORT=0) starten und sauber wieder
// schließen können.
module.exports = server;
