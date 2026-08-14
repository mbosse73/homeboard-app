'use strict';

// Alle Datumsberechnungen laufen über Europe/Berlin und nicht über die Systemzeit -
// der Server läuft im Container üblicherweise in UTC, und um 00:30 Ortszeit wäre "heute"
// sonst noch der Vortag.

const ZEITZONE = 'Europe/Berlin';

// ISO-Datum (YYYY-MM-DD) für heute plus offsetTage. sv-SE liefert genau dieses Format.
function tagISO(offsetTage = 0) {
  const basis = new Date(Date.now() + offsetTage * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZEITZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(basis);
}

function heuteISO() {
  return tagISO(0);
}

function morgenISO() {
  return tagISO(1);
}

// "Freitag, 15.08.2026" aus "2026-08-15". Mittags-UTC als Bezugspunkt, damit keine
// Zeitzonenverschiebung den Tag um eins verrutschen lässt.
function lesbaresDatum(iso) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: ZEITZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`));
}

module.exports = { tagISO, heuteISO, morgenISO, lesbaresDatum, ZEITZONE };
