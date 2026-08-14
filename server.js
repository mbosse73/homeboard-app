'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { erstelleKinoprogramm } = require('./lib/kino');

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 Minuten
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
  if (bestehend && bestehend.datum === heuteISO()) {
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
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/kino') {
    try {
      const erzwingen = url.searchParams.get('refresh') === '1';
      const daten = await holeKinoDaten(erzwingen);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(daten));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ fehler: err.message }));
    }
    return;
  }

  let dateiPfad = url.pathname === '/' ? '/index.html' : url.pathname;
  dateiPfad = path.normalize(path.join(__dirname, dateiPfad));
  if (!dateiPfad.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Verboten');
    return;
  }

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
