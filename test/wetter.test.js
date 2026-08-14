'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { holeWetter, VORHERSAGE_TAGE, STUNDEN_VORAUS, _intern } = require('../lib/wetter');

const { normalisiere, url } = _intern;

const echterFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = echterFetch;
});

// Antwort im Format von Open-Meteo: 48 Stundenwerte ab Mitternacht, drei Tageswerte.
function rohdaten(aktuelleZeit = '2026-08-14T15:20') {
  const stunden = [];
  for (let tag = 0; tag < 2; tag++) {
    for (let h = 0; h < 24; h++) {
      stunden.push(`2026-08-${14 + tag}T${String(h).padStart(2, '0')}:00`);
    }
  }
  return {
    current: {
      time: aktuelleZeit,
      temperature_2m: 21.4,
      apparent_temperature: 20.1,
      weather_code: 3,
      wind_speed_10m: 12.6,
      relative_humidity_2m: 61,
    },
    hourly: {
      time: stunden,
      temperature_2m: stunden.map((_, i) => 10 + (i % 12)),
      weather_code: stunden.map(() => 2),
      precipitation_probability: stunden.map((_, i) => i % 100),
    },
    daily: {
      time: ['2026-08-14', '2026-08-15', '2026-08-16'],
      temperature_2m_max: [24.2, 26.7, 22.1],
      temperature_2m_min: [13.8, 15.2, 12.9],
      precipitation_probability_max: [20, 0, 70],
      weather_code: [3, 1, 61],
    },
  };
}

test('normalisiere übersetzt die Open-Meteo-Antwort in die Projektsprache', () => {
  const w = normalisiere(rohdaten());

  assert.strictEqual(w.ort, 'Magdeburg');
  assert.ok(Date.parse(w.generiertAm), 'generiertAm muss ein gültiger Zeitstempel sein');

  assert.strictEqual(w.jetzt.temperatur, 21.4);
  assert.strictEqual(w.jetzt.gefuehlt, 20.1);
  assert.strictEqual(w.jetzt.code, 3);
  assert.strictEqual(w.jetzt.wind, 12.6);
  assert.strictEqual(w.jetzt.luftfeuchte, 61);

  assert.strictEqual(w.tage.length, 3);
  assert.strictEqual(w.tage[0].datum, '2026-08-14');
  assert.strictEqual(w.tage[0].datumLesbar, 'Freitag, 14.08.2026');
  assert.strictEqual(w.tage[0].max, 24.2);
  assert.strictEqual(w.tage[0].min, 13.8);
  assert.strictEqual(w.tage[2].regenrisiko, 70);
});

test('normalisiere beginnt die Stundenleiste bei der laufenden Stunde', () => {
  const w = normalisiere(rohdaten('2026-08-14T15:20'));

  assert.strictEqual(w.stunden.length, STUNDEN_VORAUS);
  assert.strictEqual(w.stunden[0].zeit, '2026-08-14T15:00', 'die angebrochene Stunde bleibt sichtbar');
  assert.strictEqual(w.stunden[w.stunden.length - 1].zeit, '2026-08-15T14:00');

  // Die Werte müssen zum jeweiligen Zeitpunkt gehören, nicht zum Index 0 der Rohdaten.
  const roh = rohdaten();
  const index = roh.hourly.time.indexOf('2026-08-14T15:00');
  assert.strictEqual(w.stunden[0].temperatur, roh.hourly.temperature_2m[index]);
  assert.strictEqual(w.stunden[0].regenrisiko, roh.hourly.precipitation_probability[index]);
});

test('normalisiere kommt mit einer Uhrzeit vor dem ersten Stundenwert zurecht', () => {
  const w = normalisiere(rohdaten('2026-08-13T23:50'));
  assert.strictEqual(w.stunden[0].zeit, '2026-08-14T00:00');
});

test('normalisiere lehnt eine unvollständige Antwort ab', () => {
  for (const kaputt of [null, {}, { current: {} }, { current: {}, hourly: {} }]) {
    assert.throws(() => normalisiere(kaputt), /unerwartete Antwortstruktur/);
  }
});

test('die Abfrage-URL fordert den konfigurierten Vorhersagezeitraum an', () => {
  const u = url();
  assert.ok(u.includes(`forecast_days=${VORHERSAGE_TAGE}`));
  assert.ok(u.includes('timezone=Europe%2FBerlin'), 'ohne Zeitzone kämen UTC-Zeiten zurück');
  assert.ok(u.startsWith('https://api.open-meteo.com/'));
});

test('holeWetter meldet einen HTTP-Fehler statt eine leere Vorhersage zu liefern', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => holeWetter(), /Open-Meteo: HTTP 429/);
});

test('holeWetter reicht ein AbortSignal an fetch durch', async () => {
  let signal = null;
  globalThis.fetch = async (_, options = {}) => {
    signal = options.signal;
    return { ok: true, status: 200, json: async () => rohdaten() };
  };
  const w = await holeWetter();
  assert.ok(signal instanceof AbortSignal, 'ohne AbortSignal gibt es kein Zeitlimit');
  assert.strictEqual(w.tage.length, 3);
});
