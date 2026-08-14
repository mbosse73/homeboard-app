'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { erstelleAlbenliste, QUELLE, _intern } = require('../lib/musik');

const {
  datumAusZeile,
  artikelBereich,
  alsAlbum,
  abschnitte,
  waehleAbschnitt,
  erstelleAbschnitt,
  passenderTreffer,
  coverSucheUrl,
  holeCover,
  ergaenzeCover,
} = _intern;

const echterFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = echterFetch;
});

// Nachbau der tonspion-Seite nach dem tatsächlichen Aufbau: eine Monatsüberschrift, darunter
// mehrere Datumszeilen im Format TT.MM.JJ und je Datum die Alben als <br>-umbrochene Liste.
// Die Seite führt auch kommende Freitage - genau deshalb reicht es nicht, alle Zeilen der Seite
// einzusammeln.
const SEITE = `<!doctype html><html><head><title>Neue Alben</title></head><body>
<nav><p>Startseite - Musik</p></nav>
<main><article>
  <p><a href="/mixtape/club">Mixtape: Club Music</a><br>
     <a href="/news/ueberblick">Neue Alben im &Uuml;berblick</a></p>
  <h2>August 2026</h2>
  <p><em>07.08.26</em><br>
     Letzte Woche &#8211; Altes Album</p>
  <p><em>14.08.26</em><br>
     Benny Blanco &#8211; Hermoso<br>
     Boston Manor &#8211; Be Nothing. 10 Year Anniversary<br>
     Der Nino Aus Wien &#8211; Neubau Alone<br>
     Dent May The Big One<br>
     Icona Pop &#8211; Ritual (Big Beat)<br>
     Benny Blanco &#8211; Hermoso</p>
  <p><em>21.08.26</em><br>
     Kommende Woche &#8211; Noch Nicht Da</p>
</article></main>
<footer><p>Impressum - Datenschutz</p></footer>
</body></html>`;

function html(text) {
  return { ok: true, status: 200, text: async () => text };
}

function itunesTreffer(artistName, artworkUrl100) {
  return { ok: true, status: 200, json: async () => ({ results: [{ artistName, artworkUrl100 }] }) };
}

// ---------- Datum ----------

test('datumAusZeile erkennt das zweistellige Format der Quelle', () => {
  assert.strictEqual(datumAusZeile('14.08.26'), '2026-08-14');
  assert.strictEqual(datumAusZeile('1.9.26'), '2026-09-01');
  assert.strictEqual(datumAusZeile('14.08.2026'), '2026-08-14');
  assert.strictEqual(datumAusZeile('Freitag, 14.08.26'), '2026-08-14');
  assert.strictEqual(datumAusZeile('  14.08.26  '), '2026-08-14');
});

test('datumAusZeile greift nur bei reinen Datumszeilen', () => {
  // Sonst würde ein Datum im Fließtext einen neuen Abschnitt aufmachen.
  assert.strictEqual(datumAusZeile('Erschienen am 14.08.26 bei Domino'), null);
  assert.strictEqual(datumAusZeile('August 2026'), null);
  assert.strictEqual(datumAusZeile('Benny Blanco – Hermoso'), null);
  assert.strictEqual(datumAusZeile('40.13.26'), null, 'unmögliche Werte werden verworfen');
});

// ---------- Zeilen und Albumerkennung ----------

test('artikelBereich blendet Navigation und Fußzeile aus', () => {
  const bereich = artikelBereich(SEITE);
  assert.ok(bereich.includes('Benny Blanco'));
  assert.ok(!bereich.includes('Impressum'));
  assert.ok(!bereich.includes('Startseite'));
});

test('alsAlbum zerlegt "Interpret – Titel" und räumt Beiwerk weg', () => {
  assert.deepStrictEqual(alsAlbum({ text: 'Benny Blanco – Hermoso', href: null }), {
    interpret: 'Benny Blanco', titel: 'Hermoso', info: null, url: null, coverUrl: null,
  });

  assert.strictEqual(alsAlbum({ text: '7. Jamie xx - In Waves', href: null }).interpret, 'Jamie xx');

  const mitLabel = alsAlbum({ text: 'Icona Pop – Ritual (Big Beat)', href: null });
  assert.strictEqual(mitLabel.titel, 'Ritual');
  assert.strictEqual(mitLabel.info, 'Big Beat');

  // Getrennt wird am ersten Strich - Striche im Albumtitel bleiben stehen.
  const mehrfach = alsAlbum({ text: 'Tocotronic – Golden Years – Deluxe Edition', href: null });
  assert.strictEqual(mehrfach.interpret, 'Tocotronic');
  assert.strictEqual(mehrfach.titel, 'Golden Years – Deluxe Edition');
});

test('alsAlbum behält Zeilen ohne Trenner als Ganzes', () => {
  // Auf der Quelle fehlt bei manchen Zeilen der Gedankenstrich. Ein geratener Schnitt
  // ("Dent May" / "The Big One"?) wäre schlechter als ein ungetrennter Eintrag.
  const ohneTrenner = alsAlbum({ text: 'Dent May The Big One', href: null });
  assert.strictEqual(ohneTrenner.interpret, 'Dent May The Big One');
  assert.strictEqual(ohneTrenner.titel, null);
});

test('alsAlbum verwirft, was kein Albumeintrag ist', () => {
  assert.strictEqual(alsAlbum({ text: '14.08.26', href: null }), null, 'Datumszeilen sind keine Alben');
  assert.strictEqual(alsAlbum({ text: 'Mixtape: Club Music', href: null }), null);
  assert.strictEqual(alsAlbum({ text: '', href: null }), null);
  assert.strictEqual(alsAlbum({ text: '2026', href: null }), null);
  assert.strictEqual(
    alsAlbum({ text: 'Jeden Freitag erscheinen neue Platten, hier sind die wichtigsten.', href: null }),
    null,
    'Fließtext endet mit Satzzeichen'
  );
  assert.strictEqual(alsAlbum({ text: '5 - 10 Euro', href: null }), null);
});

test('alsAlbum macht relative Links absolut und lässt nur http(s) zu', () => {
  assert.strictEqual(
    alsAlbum({ text: 'Jamie xx – In Waves', href: '/album/x' }).url,
    'https://www.tonspion.de/album/x'
  );
  assert.strictEqual(alsAlbum({ text: 'Jamie xx – In Waves', href: 'javascript:alert(1)' }).url, null);
});

// ---------- Abschnitte ----------

test('abschnitte trennt die Seite nach Datumszeilen auf', () => {
  const liste = abschnitte(SEITE);
  assert.deepStrictEqual(liste.map((a) => a.datum), ['2026-08-07', '2026-08-14', '2026-08-21']);

  const woche = liste[1];
  assert.deepStrictEqual(
    woche.alben.map((a) => a.interpret),
    ['Benny Blanco', 'Boston Manor', 'Der Nino Aus Wien', 'Dent May The Big One', 'Icona Pop'],
    'Dublette raus, Zeile ohne Trenner bleibt drin'
  );
  // Alles vor der ersten Datumszeile gehört zu keinem Abschnitt.
  assert.ok(!liste.some((a) => a.alben.some((b) => /Mixtape|Überblick/.test(b.interpret))));
});

test('waehleAbschnitt nimmt den jüngsten bereits erschienenen Freitag', () => {
  const liste = abschnitte(SEITE);

  assert.strictEqual(waehleAbschnitt(liste, '2026-08-14').datum, '2026-08-14', 'am Erscheinungstag');
  assert.strictEqual(waehleAbschnitt(liste, '2026-08-18').datum, '2026-08-14', 'mitten in der Woche');
  assert.strictEqual(waehleAbschnitt(liste, '2026-08-21').datum, '2026-08-21', 'neuer Freitag, neue Alben');
  assert.strictEqual(waehleAbschnitt(liste, '2026-08-13').datum, '2026-08-07', 'noch nicht erschienen');

  // Steht nur Zukünftiges auf der Seite, bleibt die Kachel trotzdem gefüllt.
  assert.strictEqual(waehleAbschnitt(liste, '2026-07-01').datum, '2026-08-07');
});

test('erstelleAbschnitt scheitert laut, wenn das Layout nicht mehr passt', () => {
  // Genau der gefährliche Fall: die Seite antwortet, aber es ist nichts Erkennbares darin.
  // Eine leere Liste sähe aus wie "diese Woche erscheint nichts".
  assert.throws(
    () => erstelleAbschnitt('<html><body><main><article><h2>August 2026</h2>'
      + '<p>Wir haben umgebaut, die Liste steht jetzt an einer ganz anderen Stelle.</p>'
      + '<p>Schauen Sie einfach in unserer neuen Rubrik nach den Alben der Woche.</p>'
      + '</article></main></body></html>'),
    /keine Datumsabschnitte gefunden/
  );

  assert.throws(
    () => erstelleAbschnitt('<html><body><main><article><h2>August 2026</h2>'
      + '<p><em>14.08.26</em></p><p><em>21.08.26</em></p>'
      + '<p>Diese Seite ist gerade im Umbau, die Alben tragen wir gleich nach.</p>'
      + '</article></main></body></html>'),
    /keine Albumzeilen darin/
  );
});

// ---------- Cover ----------

test('passenderTreffer akzeptiert Schreibvarianten, nicht aber fremde Interpreten', () => {
  assert.ok(passenderTreffer({ artistName: 'Benny Blanco' }, 'Benny Blanco'));
  assert.ok(passenderTreffer({ artistName: 'Sigur Rós' }, 'Sigur Ros'), 'Akzente dürfen egal sein');
  assert.ok(passenderTreffer({ artistName: 'Icona Pop' }, 'ICONA POP'));
  // Zeile ohne Trenner: der Interpretenname steckt im Gesamttext.
  assert.ok(passenderTreffer({ artistName: 'Dent May' }, 'Dent May The Big One'));
  assert.ok(!passenderTreffer({ artistName: 'Karaoke Allstars' }, 'Benny Blanco'));
  assert.ok(!passenderTreffer(null, 'Benny Blanco'));
});

test('coverSucheUrl kommt auch ohne Albumtitel aus', () => {
  const mitTitel = coverSucheUrl({ interpret: 'Benny Blanco', titel: 'Hermoso' });
  assert.ok(mitTitel.includes('entity=album'));
  assert.ok(mitTitel.includes(encodeURIComponent('Benny Blanco Hermoso')));

  const ohneTitel = coverSucheUrl({ interpret: 'Dent May The Big One', titel: null });
  assert.ok(ohneTitel.includes(encodeURIComponent('Dent May The Big One')));
  assert.ok(!ohneTitel.includes('null'));
});

test('holeCover liefert ein größeres Bild und prüft den Interpreten', async () => {
  globalThis.fetch = async () => itunesTreffer('Benny Blanco', 'https://is1.mzstatic.com/x/100x100bb.jpg');
  const cover = await holeCover({ interpret: 'Benny Blanco', titel: 'Hermoso' });
  assert.strictEqual(cover, 'https://is1.mzstatic.com/x/400x400bb.jpg');

  globalThis.fetch = async () => itunesTreffer('Irgendein Coverband', 'https://is1.mzstatic.com/x/100x100bb.jpg');
  assert.strictEqual(
    await holeCover({ interpret: 'Benny Blanco', titel: 'Hermoso' }),
    null,
    'lieber kein Cover als das falsche'
  );
});

test('holeCover reicht ein AbortSignal durch und meldet HTTP-Fehler', async () => {
  let signal = null;
  globalThis.fetch = async (_, options = {}) => {
    signal = options.signal;
    return { ok: false, status: 403 };
  };
  await assert.rejects(() => holeCover({ interpret: 'A', titel: 'B' }), /iTunes-Suche: HTTP 403/);
  assert.ok(signal instanceof AbortSignal, 'ohne AbortSignal gibt es kein Zeitlimit');
});

test('ein gescheitertes Cover kostet nicht das Album', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('Kaputt')) throw new Error('Netz weg');
    return itunesTreffer('Heile Welt', 'https://is1.mzstatic.com/y/100x100bb.jpg');
  };
  const alben = await ergaenzeCover([
    { interpret: 'Kaputt', titel: 'X', coverUrl: null },
    { interpret: 'Heile Welt', titel: 'Y', coverUrl: null },
  ]);
  assert.strictEqual(alben.length, 2);
  assert.strictEqual(alben[0].coverUrl, null);
  assert.strictEqual(alben[1].coverUrl, 'https://is1.mzstatic.com/y/400x400bb.jpg');
});

// ---------- Zusammenbau ----------

test('erstelleAlbenliste setzt Datum, Quelle und Cover zusammen', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('tonspion')) return html(SEITE);
    if (String(url).includes('itunes')) return itunesTreffer('Benny Blanco', 'https://is1.mzstatic.com/z/100x100bb.jpg');
    throw new Error(`Unerwarteter Abruf im Test: ${url}`);
  };

  const daten = await erstelleAlbenliste();
  assert.strictEqual(daten.quelle, QUELLE);
  assert.ok(Date.parse(daten.generiertAm), 'generiertAm muss ein gültiger Zeitstempel sein');
  assert.match(daten.datum, /^2026-08-(07|14|21)$/, 'eines der Daten aus der Seite');
  assert.strictEqual(daten.datumLesbar, `Freitag, ${daten.datum.slice(8)}.08.2026`);
  assert.ok(daten.alben.length > 0);

  // Nur der passende Interpret bekommt ein Cover, die übrigen bleiben ohne - aber vorhanden.
  const mitCover = daten.alben.filter((a) => a.coverUrl);
  assert.ok(mitCover.every((a) => a.coverUrl === 'https://is1.mzstatic.com/z/400x400bb.jpg'));
});

test('erstelleAlbenliste meldet einen HTTP-Fehler der Quelle', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => erstelleAlbenliste(), /tonspion\.de: HTTP 503/);
});
