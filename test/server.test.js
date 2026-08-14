'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// PORT=0 lässt das Betriebssystem einen freien Port wählen - der Test kollidiert damit nicht
// mit einem laufenden Homeboard.
process.env.PORT = '0';
const server = require('../server.js');
const { heuteISO } = require('../lib/datum');

const echterFetch = globalThis.fetch;
let basis;

test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  globalThis.fetch = echterFetch;
  await new Promise((r) => server.close(r));
});

// Der Server ruft Fremd-APIs über das globale fetch auf. Für die Tests wird es ersetzt; der
// echte Aufruf an den eigenen Server läuft über http.get, damit der Stub ihn nicht abfängt.
const http = require('node:http');
function hole(pfad) {
  return new Promise((resolve, reject) => {
    http
      .get(basis + pfad, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, typ: res.headers['content-type'] || '', text }));
      })
      .on('error', reject);
  });
}

test('die Allowlist gibt nur Frontend-Dateien heraus', async () => {
  for (const pfad of ['/', '/index.html', '/app.css', '/app.js']) {
    const res = await hole(pfad);
    assert.strictEqual(res.status, 200, `${pfad} sollte ausgeliefert werden`);
    assert.ok(res.text.length > 0, `${pfad} ist leer`);
  }
});

test('alles außerhalb der Allowlist bleibt verborgen', async () => {
  const verboten = [
    '/server.js',
    '/package.json',
    '/package-lock.json',
    '/.git/config',
    '/.gitignore',
    '/lib/kino.js',
    '/lib/wetter.js',
    '/CLAUDE.md',
    '/data/kino-' + heuteISO() + '.json',
    '/node_modules/playwright/package.json',
    '/test/server.test.js',
  ];
  for (const pfad of verboten) {
    const res = await hole(pfad);
    assert.strictEqual(res.status, 404, `${pfad} darf nicht ausgeliefert werden`);
  }
});

test('/api/kino akzeptiert nur heute und morgen', async () => {
  const res = await hole('/api/kino?tag=uebermorgen');
  assert.strictEqual(res.status, 400);
  assert.match(JSON.parse(res.text).fehler, /Unbekannter Tag/);

  // Ein freier Datumsparameter darf nicht durchrutschen.
  const res2 = await hole('/api/kino?tag=2030-01-01');
  assert.strictEqual(res2.status, 400);
});

test('ein Totalausfall wird nicht auf die Platte geschrieben', async () => {
  const datei = path.join(__dirname, '..', 'data', `kino-${heuteISO()}.json`);
  const vorher = fs.existsSync(datei) ? fs.statSync(datei).mtimeMs : null;

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const res = await hole('/api/kino?tag=heute');
  assert.strictEqual(res.status, 200);

  const daten = JSON.parse(res.text);
  assert.strictEqual(daten.kinos.length, 4);
  assert.ok(
    daten.kinos.every((k) => k.filme.length === 0),
    'in diesem Szenario darf kein Kino Filme liefern'
  );

  const nachher = fs.existsSync(datei) ? fs.statSync(datei).mtimeMs : null;
  assert.strictEqual(nachher, vorher, 'ein filmloses Ergebnis darf den Cache auf Platte nicht anfassen');
});

test('/api/wetter liefert die normalisierte Vorhersage und cacht sie', async () => {
  let abrufe = 0;
  globalThis.fetch = async () => {
    abrufe++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          time: '2026-08-14T15:20',
          temperature_2m: 21.4,
          apparent_temperature: 20.1,
          weather_code: 3,
          wind_speed_10m: 12.6,
          relative_humidity_2m: 61,
        },
        hourly: {
          time: ['2026-08-14T15:00', '2026-08-14T16:00'],
          temperature_2m: [21, 22],
          weather_code: [3, 2],
          precipitation_probability: [10, 20],
        },
        daily: {
          time: ['2026-08-14'],
          temperature_2m_max: [24.2],
          temperature_2m_min: [13.8],
          precipitation_probability_max: [20],
          weather_code: [3],
        },
      }),
    };
  };

  const res = await hole('/api/wetter');
  assert.strictEqual(res.status, 200);
  assert.match(res.typ, /application\/json/);
  const w = JSON.parse(res.text);
  assert.strictEqual(w.ort, 'Magdeburg');
  assert.strictEqual(w.jetzt.temperatur, 21.4);
  assert.strictEqual(w.tage[0].datumLesbar, 'Freitag, 14.08.2026');
  assert.strictEqual(abrufe, 1);

  await hole('/api/wetter');
  assert.strictEqual(abrufe, 1, 'der zweite Aufruf muss aus dem Cache kommen');

  await hole('/api/wetter?refresh=1');
  assert.strictEqual(abrufe, 2, 'refresh=1 muss den Cache umgehen');
});

test('/api/wetter hält bei einer Störung den letzten Stand', async () => {
  globalThis.fetch = async () => {
    throw new Error('Netz weg');
  };
  const res = await hole('/api/wetter?refresh=1');
  assert.strictEqual(res.status, 200, 'ein kurzer Ausfall darf die Kachel nicht leeren');
  assert.strictEqual(JSON.parse(res.text).jetzt.temperatur, 21.4);
});

// Der Alben-Cache liegt als data/alben.json auf der Platte. Läuft der Test auf dem Server,
// darf er eine echte gespeicherte Liste nicht zerstören - deshalb sichern und zurücklegen.
const ALBEN_DATEI = path.join(__dirname, '..', 'data', 'alben.json');
let albenVorher = null;

test.before(() => {
  albenVorher = fs.existsSync(ALBEN_DATEI) ? fs.readFileSync(ALBEN_DATEI, 'utf8') : null;
});
test.after(() => {
  if (albenVorher !== null) fs.writeFileSync(ALBEN_DATEI, albenVorher, 'utf8');
  else if (fs.existsSync(ALBEN_DATEI)) fs.unlinkSync(ALBEN_DATEI);
});

// Aufbau wie auf der echten Seite: Monatsüberschrift, Datumszeilen im Format TT.MM.JJ, darunter
// die Alben. Das Datum liegt bewusst in der Vergangenheit, damit der Abschnitt unabhängig vom
// Testzeitpunkt als "bereits erschienen" gilt.
const ALBEN_SEITE = `<html><body><main><article>
  <h2>Januar 2020</h2>
  <p><em>03.01.20</em><br>
     Beth Gibbons &#8211; Lives Outgrown<br>
     Jamie xx &#8211; In Waves</p>
</article></main></body></html>`;

test('/api/alben liefert die Wochenliste und speichert sie', async () => {
  let seitenAbrufe = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('tonspion')) {
      seitenAbrufe++;
      return { ok: true, status: 200, text: async () => ALBEN_SEITE };
    }
    // Cover-Suche: kein Treffer, das Album muss trotzdem erscheinen.
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };

  const res = await hole('/api/alben');
  assert.strictEqual(res.status, 200);
  assert.match(res.typ, /application\/json/);

  const daten = JSON.parse(res.text);
  assert.strictEqual(daten.datum, '2020-01-03');
  assert.strictEqual(daten.datumLesbar, 'Freitag, 03.01.2020');
  assert.strictEqual(daten.alben.length, 2);
  assert.strictEqual(daten.alben[0].interpret, 'Beth Gibbons');
  assert.strictEqual(daten.alben[0].coverUrl, null, 'ohne Cover bleibt das Album bestehen');
  assert.strictEqual(seitenAbrufe, 1);

  await hole('/api/alben');
  assert.strictEqual(seitenAbrufe, 1, 'der zweite Aufruf muss aus dem Cache kommen');

  await hole('/api/alben?refresh=1');
  assert.strictEqual(seitenAbrufe, 2, 'refresh=1 muss den Cache umgehen');

  assert.ok(fs.existsSync(ALBEN_DATEI), 'eine brauchbare Liste wird für den warmen Start gespeichert');
});

test('/api/alben hält bei einer Störung den letzten Stand und benennt den Grund', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  const res = await hole('/api/alben?refresh=1');
  assert.strictEqual(res.status, 200, 'eine Störung darf die Kachel nicht leeren');

  const daten = JSON.parse(res.text);
  assert.strictEqual(daten.alben.length, 2, 'der letzte brauchbare Stand bleibt stehen');
  assert.match(daten.fehler, /HTTP 503/, 'das Frontend muss sagen können, warum es nicht frisch ist');
});

test('unbekannte Routen antworten mit 404', async () => {
  const res = await hole('/api/gibtsnicht');
  assert.strictEqual(res.status, 404);
});
