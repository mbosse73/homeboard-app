'use strict';

// Gemeinsamer HTTP-Helfer für alle Fremdanfragen (Kino-Scraper und Wetter-Proxy).
// Kein nacktes fetch() im Projekt: ohne Zeitlimit blockiert eine hängende Fremd-API die
// zugehörige API-Route unbegrenzt.

const STANDARD_TIMEOUT_MS = 10000;

function holeMitTimeout(url, options = {}, timeoutMs = STANDARD_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// Begrenzt eine beliebige Promise zeitlich. Der zugrundeliegende Vorgang läuft im Hintergrund
// weiter (Playwright schließt seinen Browser über das eigene finally), aber der Aufrufer
// hängt nicht daran fest.
function mitZeitlimit(promise, ms, beschreibung) {
  let timer;
  const wecker = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${beschreibung}: Zeitlimit von ${ms / 1000}s überschritten`)), ms);
  });
  return Promise.race([promise, wecker]).finally(() => clearTimeout(timer));
}

module.exports = { holeMitTimeout, mitZeitlimit, STANDARD_TIMEOUT_MS };
