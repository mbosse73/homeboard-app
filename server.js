'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { erstelleKinoprogramm } = require('./lib/kino');

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 Minuten
const FEHLER_TTL_MS = 3 * 60 * 1000; // Lieferte kein Kino Filme, nach 3 Minuten erneut versuchen
const DATENPFAD = path.join(__dirname, 'data', 'kino.json');

function heuteISO() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

let cache = null; // { datum, daten, geladenUm }
let laufenderScrape = null; // Promise, verhindert parallele Mehrfach-Scrapes bei gleichzeitigen Requests

// Beim Start: falls eine bereits generierte Datei von heute existiert, direkt als warmen Cache übernehmen,
// damit der erste Seitenaufruf nach einem Server-Neustart nicht zwingend 20-30s warten muss.
try {
  const bestehend = JSON.parse(fs.readFileSync(DATENPFAD, 'utf8'));
  if (bestehend && bestehend.datum === heuteISO() && (bestehend.kinos || []).some((k) => (k.filme || []).length > 0)) {
    cache = { datum: bestehend.datum, daten: bestehend, geladenUm: Date.parse(bestehend.generiertAm) || Date.now() };
    console.log('Bestehende Kinodaten von heute als Cache übernommen.');
  }
} catch (e) {
  // keine oder unlesbare Datei -> beim ersten Request wird frisch geladen
}

async function holeKinoDaten(erzwingen) {
  const heute = heuteISO();
  if (!erzwingen && cache && cache.datum === heute && Date.now() - cache.geladenUm < CACHE_TTL_MS) {
    return cache.daten;
  }
  if (!laufenderScrape) {
    laufenderScrape = erstelleKinoprogramm().finally(() => {
      laufenderScrape = null;
    });
  }
  const daten = await laufenderScrape;

  // Hat kein einziges Kino Filme geliefert, ist das mit hoher Wahrscheinlichkeit eine Störung
  // (Netzausfall, alle Seiten umgebaut) und kein spielfreier Tag. Solch ein Ergebnis darf weder
  // 45 Minuten im RAM festhängen noch den zuletzt brauchbaren Stand auf der Platte überschreiben.
  const brauchbar = daten.kinos.some((k) => k.filme.length > 0);
  if (!brauchbar) {
    console.warn('Kein Kino lieferte Filme - Ergebnis wird nur kurz gecacht und nicht gespeichert.');
    cache = { datum: heute, daten, geladenUm: Date.now() - CACHE_TTL_MS + FEHLER_TTL_MS };
    return daten;
  }

  cache = { datum: heute, daten, geladenUm: Date.now() };
  try {
    fs.mkdirSync(path.dirname(DATENPFAD), { recursive: true });
    fs.writeFileSync(DATENPFAD, JSON.stringify(daten, null, 2), 'utf8');
  } catch (e) {
    console.warn('Konnte Kino-Cache-Datei nicht schreiben:', e.message);
  }
  return daten;
}

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
]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/kino') {
    try {
      const erzwingen = url.searchParams.get('refresh') === '1';
      const daten = await holeKinoDaten(erzwingen);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(daten));
    } catch (err) {
      // Absicherung, kein Regelfall: erstelleKinoprogramm() fängt Fehler pro Kino ab und wirft
      // normalerweise nicht. Greift dieser Zweig, ist etwas Unerwartetes passiert (z.B. defekte
      // Intl-Daten) - dann ist eine saubere 502 besser als ein Absturz des Request-Handlers.
      console.error('Unerwarteter Fehler in /api/kino:', err);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ fehler: err.message }));
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
  console.log(`Homeboard läuft auf http://localhost:${PORT}`);
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
