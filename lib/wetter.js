'use strict';

const { holeMitTimeout } = require('./http');
const { lesbaresDatum } = require('./datum');

// Magdeburg
const KOORDINATEN = { lat: 52.1205, lon: 11.6276 };

// Heute plus vier Folgetage. Open-Meteo liefert die Tageswerte in daily, die Stundenwerte
// entsprechend für den ganzen Zeitraum - davon wird unten nur ein Tagesausschnitt behalten.
const VORHERSAGE_TAGE = 5;

// Wie viele Stunden die Stundenleiste ab jetzt nach vorn zeigt.
const STUNDEN_VORAUS = 24;

const WETTER_TIMEOUT_MS = 10000;

function url() {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${KOORDINATEN.lat}&longitude=${KOORDINATEN.lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
    `&timezone=Europe%2FBerlin&forecast_days=${VORHERSAGE_TAGE}`
  );
}

// Aus der Open-Meteo-Antwort wird eine Struktur in der Projektsprache gebaut. Das Frontend
// bekommt damit dieselbe Formsprache wie beim Kinoprogramm und muss keine API-Feldnamen kennen.
function normalisiere(roh) {
  if (!roh || !roh.current || !roh.hourly || !roh.daily) {
    throw new Error('Open-Meteo: unerwartete Antwortstruktur');
  }

  // Alles ab der laufenden Stunde. Die Zeiten kommen als lokale ISO-Strings ("2026-08-14T15:00"),
  // ein Stringvergleich reicht daher zum Finden des Einstiegspunkts.
  const aktuelleStunde = String(roh.current.time).slice(0, 13);
  const start = Math.max(
    roh.hourly.time.findIndex((z) => z.slice(0, 13) >= aktuelleStunde),
    0
  );
  const stunden = roh.hourly.time.slice(start, start + STUNDEN_VORAUS).map((zeit, i) => ({
    zeit,
    temperatur: roh.hourly.temperature_2m[start + i],
    code: roh.hourly.weather_code[start + i],
    regenrisiko: roh.hourly.precipitation_probability[start + i],
  }));

  const tage = roh.daily.time.map((datum, i) => ({
    datum,
    datumLesbar: lesbaresDatum(datum),
    min: roh.daily.temperature_2m_min[i],
    max: roh.daily.temperature_2m_max[i],
    code: roh.daily.weather_code[i],
    regenrisiko: roh.daily.precipitation_probability_max[i],
  }));

  return {
    ort: 'Magdeburg',
    generiertAm: new Date().toISOString(),
    jetzt: {
      zeit: roh.current.time,
      temperatur: roh.current.temperature_2m,
      gefuehlt: roh.current.apparent_temperature,
      code: roh.current.weather_code,
      wind: roh.current.wind_speed_10m,
      luftfeuchte: roh.current.relative_humidity_2m,
    },
    stunden,
    tage,
  };
}

async function holeWetter() {
  const res = await holeMitTimeout(url(), { headers: { accept: 'application/json' } }, WETTER_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  return normalisiere(await res.json());
}

module.exports = {
  holeWetter,
  VORHERSAGE_TAGE,
  STUNDEN_VORAUS,
  // Nur für die Smoke-Tests in test/. Nicht Teil der öffentlichen Modul-API.
  _intern: { normalisiere, url },
};
