'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { erstelleKinoprogramm, _intern } = require('../lib/kino');
const { heuteISO, morgenISO } = require('../lib/datum');

const { holeCineStar, holeCinemaxx, holeStudiokino } = _intern;

// Alle Tests hier laufen ohne Netzzugriff: fetch wird ersetzt. Moritzhof lässt sich so nicht
// stubben (Playwright statt fetch) und scheitert daher im Test - genau das prüft der
// Isolationstest weiter unten.
const echterFetch = globalThis.fetch;

function stubFetch(antworten) {
  globalThis.fetch = async (url) => {
    for (const [muster, antwort] of antworten) {
      if (String(url).includes(muster)) return antwort();
    }
    throw new Error(`Unerwarteter Abruf im Test: ${url}`);
  };
}

function json(objekt) {
  return () => ({ ok: true, status: 200, json: async () => objekt });
}

function html(text) {
  return () => ({ ok: true, status: 200, text: async () => text });
}

test.afterEach(() => {
  globalThis.fetch = echterFetch;
});

test('CineStar: filtert auf den angefragten Tag und entfernt interne Felder', async () => {
  const heute = heuteISO();
  stubFetch([
    [
      '/api/cinema/37/show/',
      json([
        {
          title: 'Testfilm',
          subtitle: 'OmU',
          movie: 42,
          showtimes: [
            { datetime: `${heute}T20:15:00` },
            { datetime: `${heute}T17:00:00` },
            { datetime: '2000-01-01T10:00:00' },
          ],
        },
        { title: 'Gestern gelaufen', movie: 43, showtimes: [{ datetime: '2000-01-01T10:00:00' }] },
      ]),
    ],
    ['/api/movie/42/', json({ teaser: 'Eine kurze Inhaltsangabe.' })],
  ]);

  const filme = await holeCineStar(heute);
  assert.strictEqual(filme.length, 1);
  assert.strictEqual(filme[0].titel, 'Testfilm');
  assert.deepStrictEqual(filme[0].zeiten, ['17:00', '20:15']); // sortiert
  assert.strictEqual(filme[0].beschreibung, 'Eine kurze Inhaltsangabe.');
  assert.ok(filme[0].trailerUrl.startsWith('https://www.youtube.com/results?'));
  assert.ok(!('_movieId' in filme[0]), 'internes Feld _movieId darf nicht nach außen dringen');
});

test('CineStar: HTTP-Fehler wird als Fehler gemeldet', async () => {
  stubFetch([['/api/cinema/', () => ({ ok: false, status: 503 })]]);
  await assert.rejects(() => holeCineStar(heuteISO()), /CineStar API: HTTP 503/);
});

test('CinemaxX: baut die Zeiten aus den Session-Gruppen', async () => {
  const heute = heuteISO();
  stubFetch([
    [
      '/showings/cinemas/1391/films',
      json({
        result: [
          {
            filmTitle: '  Ein Film  ',
            genres: ['Drama', 'Komödie'],
            synopsisShort: 'Kurzfassung.',
            showingGroups: [
              { sessions: [{ startTime: `${heute}T18:30:00` }, { startTime: `${heute}T15:00:00` }] },
              { sessions: [{ startTime: '2000-01-01T10:00:00' }] },
            ],
          },
        ],
      }),
    ],
  ]);

  const filme = await holeCinemaxx(heute);
  assert.strictEqual(filme.length, 1);
  assert.strictEqual(filme[0].titel, 'Ein Film');
  assert.strictEqual(filme[0].info, 'Drama, Komödie');
  assert.deepStrictEqual(filme[0].zeiten, ['15:00', '18:30']);
});

test('Studiokino: fehlender HTML-Anker wirft, statt still leer zu liefern', async () => {
  stubFetch([['studiokino.com', html('<html><body><p>Wir sind umgezogen.</p></body></html>')]]);
  await assert.rejects(() => holeStudiokino(heuteISO()), /Programm Heute/);
});

test('Studiokino: liest Titel und Zusatzinfos aus dem Tagesabschnitt', async () => {
  stubFetch([
    [
      'https://www.studiokino.com/film/1',
      html('<h1>Titel</h1><p>Kurz.</p><p>Die deutlich längere Inhaltsangabe des Films, die als Beschreibung gewinnt.</p>kartenbestell'),
    ],
    [
      'studiokino.com',
      html(`
        <h2>Programm Heute</h2>
        <article class="aktuell">
          <h2> <a href="/film/1">Der Testfilm</a></h2>
          <dl><dt>Genre</dt><dd>Drama</dd><dt>FSK</dt><dd>ab 12</dd></dl>
        </article>
        <h2>Demn&auml;chst</h2>
        <article class="aktuell"><h2> <a href="/film/2">Kommt sp&auml;ter</a></h2></article>
      `),
    ],
  ]);

  const filme = await holeStudiokino(heuteISO());
  // Die Grenze "Demnächst" steht im Fixture als Entity - sie muss trotzdem greifen, sonst
  // rutschen Vorschaufilme ohne Spieltermin ins heutige Programm.
  assert.strictEqual(filme.length, 1, 'nur der Abschnitt "Programm Heute" zählt');
  assert.strictEqual(filme[0].titel, 'Der Testfilm');
  assert.strictEqual(filme[0].info, 'Drama, ab 12');
  assert.match(filme[0].beschreibung, /deutlich längere Inhaltsangabe/);
  assert.ok(!('_detailUrl' in filme[0]));
});

test('Studiokino: erkennt die Abschnittsgrenze auch als reines Zeichen', async () => {
  stubFetch([
    ['/film/1', html('<h1>T</h1><p>Eine Inhaltsangabe von ausreichender Länge.</p>kartenbestell')],
    [
      'studiokino.com',
      html(`
        <h2>Programm Heute</h2>
        <article class="aktuell"><h2> <a href="/film/1">Heute</a></h2></article>
        <h2>Demnächst</h2>
        <article class="aktuell"><h2> <a href="/film/2">Später</a></h2></article>
      `),
    ],
  ]);
  const filme = await holeStudiokino(heuteISO());
  assert.deepStrictEqual(filme.map((f) => f.titel), ['Heute']);
});

test('Studiokino: liefert für morgen einen Hinweis statt eines Fehlers', async () => {
  // Kein Stub nötig - der Scraper darf für andere Tage gar nicht erst abrufen.
  globalThis.fetch = async () => {
    throw new Error('Für die Morgen-Vorschau darf das Studiokino nicht abgerufen werden');
  };
  const ergebnis = await holeStudiokino(morgenISO());
  assert.deepStrictEqual(ergebnis.filme, []);
  assert.match(ergebnis.hinweis, /laufenden Tages/);
});

test('erstelleKinoprogramm: ein defektes Kino reißt die anderen nicht mit', async () => {
  const heute = heuteISO();
  stubFetch([
    [
      '/api/cinema/37/show/',
      json([{ title: 'Läuft', movie: 1, showtimes: [{ datetime: `${heute}T20:00:00` }] }]),
    ],
    ['/api/movie/', () => ({ ok: false, status: 500 })],
    ['/showings/cinemas/', () => ({ ok: false, status: 500 })],
    ['studiokino.com', () => ({ ok: false, status: 403 })],
  ]);

  const daten = await erstelleKinoprogramm(heute);
  assert.strictEqual(daten.datum, heute);
  assert.match(daten.datumLesbar, /\d{2}\.\d{2}\.\d{4}$/);
  assert.strictEqual(daten.kinos.length, 4);

  const nachId = Object.fromEntries(daten.kinos.map((k) => [k.id, k]));
  assert.strictEqual(nachId.cinestar.fehler, null);
  assert.strictEqual(nachId.cinestar.filme.length, 1);
  assert.match(nachId.cinemaxx.fehler, /HTTP 500/);
  assert.match(nachId.studiokino.fehler, /HTTP 403/);
  // Moritzhof braucht einen Browser, der im Test nicht bereitsteht - ein Fehler ist hier korrekt.
  assert.ok(nachId.moritzhof.fehler, 'Moritzhof muss ohne Browser einen Fehler melden');

  // Jedes Kino trägt genau einen der drei Zustände: Filme, Hinweis oder Fehler.
  for (const kino of daten.kinos) {
    assert.ok('hinweis' in kino, `${kino.id}: hinweis-Feld fehlt`);
    if (kino.fehler) assert.strictEqual(kino.filme.length, 0, `${kino.id}: Fehler und Filme zugleich`);
  }
});

test('erstelleKinoprogramm: weist ein unsinniges Datum ab', async () => {
  await assert.rejects(() => erstelleKinoprogramm('morgen'), /Ungültiges Datum/);
  await assert.rejects(() => erstelleKinoprogramm('14.08.2026'), /Ungültiges Datum/);
});

test('erstelleKinoprogramm: die Kinos laufen parallel, nicht nacheinander', async () => {
  // Jede Fremdanfrage braucht 400ms. Sequenziell wären mindestens drei davon nacheinander
  // fällig (CineStar, CinemaxX, Studiokino), parallel bleibt es bei rund einer.
  globalThis.fetch = () => new Promise((resolve) => setTimeout(() => resolve({ ok: false, status: 503 }), 400));

  const start = Date.now();
  await erstelleKinoprogramm(heuteISO());
  const dauer = Date.now() - start;
  assert.ok(dauer < 1000, `Gesamtdauer ${dauer}ms deutet auf sequenzielle Ausführung hin`);
});

test('erstelleKinoprogramm: das AbortSignal erreicht fetch', async () => {
  let gesehen = null;
  globalThis.fetch = async (url, options = {}) => {
    if (!gesehen && options.signal) gesehen = options.signal;
    return { ok: false, status: 503 };
  };
  await erstelleKinoprogramm(heuteISO());
  assert.ok(gesehen instanceof AbortSignal, 'ohne AbortSignal gibt es kein Zeitlimit auf fetch');
});
