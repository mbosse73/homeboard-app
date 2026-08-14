'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { erstelleAlbenliste, QUELLE, _intern } = require('../lib/musik');

const {
  datumAusText,
  datumAusSeite,
  artikelBereich,
  alsAlbum,
  extrahiereAlben,
  passenderTreffer,
  coverSucheUrl,
  holeCover,
  ergaenzeCover,
} = _intern;

const echterFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = echterFetch;
});

// Nachbau einer Seite, wie tonspion sie ausliefern könnte: Datum in einer Zwischenüberschrift,
// Alben als Listenpunkte, dazwischen Navigation und Fließtext. Das echte Markup war beim
// Schreiben nicht abrufbar - deshalb prüfen die Tests die Regeln des Parsers, nicht die Quelle.
const SEITE = `<!doctype html><html><head><title>Neue Alben</title></head><body>
<nav><p>Startseite - Musik - Neuerscheinungen</p></nav>
<main><article>
  <h1>Musik-Neuerscheinungen: Die neuen Alben der Woche</h1>
  <p>Jeden Freitag erscheinen neue Platten. Wir sammeln die wichtigsten Veröffentlichungen
     der Woche und sortieren sie nach Genre, damit nichts untergeht bei all den Alben.</p>
  <h2>Neue Alben am 14.08.2026</h2>
  <ul>
    <li><a href="/album/fontaines-dc-romance">Fontaines D.C. &#8211; Romance</a></li>
    <li>1. Beth Gibbons &#8211; Lives Outgrown (Domino)</li>
    <li>Jamie xx - In Waves</li>
    <li>Tocotronic &#8211; Golden Years &#8211; Deluxe Edition</li>
    <li>Fontaines D.C. &#8211; Romance</li>
    <li>Newsletter &#8211; jetzt abonnieren</li>
  </ul>
  <h2>Demnächst</h2>
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

test('datumAusText erkennt numerische und ausgeschriebene Datumsangaben', () => {
  assert.strictEqual(datumAusText('Neue Alben am 14.08.2026'), '2026-08-14');
  assert.strictEqual(datumAusText('Freitag, 1.9.2026'), '2026-09-01');
  assert.strictEqual(datumAusText('Erschienen am 14. August 2026'), '2026-08-14');
  assert.strictEqual(datumAusText('Am 3. März 2027 geht es weiter'), '2027-03-03');
  assert.strictEqual(datumAusText('Kein Datum weit und breit'), null);
  assert.strictEqual(datumAusText('am 40.13.2026'), null, 'unmögliche Werte werden verworfen');
});

test('datumAusSeite bevorzugt die Überschrift über den Alben', () => {
  // Im <time> steht ein anderer Tag - verbindlich ist die Angabe über den Alben.
  const seite = SEITE.replace('<h1>', '<time datetime="2026-08-11">11.08.</time><h1>');
  assert.strictEqual(datumAusSeite(seite), '2026-08-14');
});

test('datumAusSeite nimmt <time> nur als Notnagel', () => {
  const ohneUeberschriftsdatum = `<html><body><time datetime="2026-08-14">heute</time>
    <h2>Neue Alben der Woche</h2></body></html>`;
  assert.strictEqual(datumAusSeite(ohneUeberschriftsdatum), '2026-08-14');
});

test('datumAusSeite scheitert laut, statt sich ein Datum auszudenken', () => {
  assert.throws(() => datumAusSeite('<html><body><h1>Nichts</h1></body></html>'), /kein Erscheinungsdatum/);
});

// ---------- Albumliste ----------

test('artikelBereich blendet Navigation und Fußzeile aus', () => {
  const bereich = artikelBereich(SEITE);
  assert.ok(bereich.includes('Fontaines'), 'der Artikelinhalt muss erhalten bleiben');
  assert.ok(!bereich.includes('Impressum'), 'die Fußzeile gehört nicht dazu');
  assert.ok(!bereich.includes('Startseite'), 'die Navigation gehört nicht dazu');
});

test('alsAlbum zerlegt "Interpret – Titel" und räumt Beiwerk weg', () => {
  assert.deepStrictEqual(alsAlbum({ text: 'Beth Gibbons – Lives Outgrown', href: null }), {
    interpret: 'Beth Gibbons', titel: 'Lives Outgrown', info: null, url: null, coverUrl: null,
  });

  // Führende Nummerierung, Klammerzusatz, einfacher Bindestrich als Trenner
  assert.strictEqual(alsAlbum({ text: '7. Jamie xx - In Waves', href: null }).interpret, 'Jamie xx');
  const mitLabel = alsAlbum({ text: 'Beth Gibbons – Lives Outgrown (Domino)', href: null });
  assert.strictEqual(mitLabel.titel, 'Lives Outgrown');
  assert.strictEqual(mitLabel.info, 'Domino');

  // Getrennt wird am ersten Strich - Striche im Albumtitel bleiben stehen.
  const mehrfach = alsAlbum({ text: 'Tocotronic – Golden Years – Deluxe Edition', href: null });
  assert.strictEqual(mehrfach.interpret, 'Tocotronic');
  assert.strictEqual(mehrfach.titel, 'Golden Years – Deluxe Edition');
});

test('alsAlbum verwirft, was kein Albumeintrag ist', () => {
  assert.strictEqual(alsAlbum({ text: 'Nur ein Satz ohne Trenner', href: null }), null);
  assert.strictEqual(alsAlbum({ text: 'Newsletter – jetzt abonnieren', href: null }), null);
  assert.strictEqual(alsAlbum({ text: '', href: null }), null);
  const langerFliesstext = 'In dieser Woche erscheinen wieder zahlreiche Platten - darunter einige, '
    + 'auf die wir uns besonders freuen, weil sie lange angekündigt waren und nun endlich da sind.';
  assert.strictEqual(alsAlbum({ text: langerFliesstext, href: null }), null, 'Fließtext ist kein Eintrag');
});

test('alsAlbum macht relative Links absolut und lässt nur http(s) zu', () => {
  assert.strictEqual(
    alsAlbum({ text: 'Jamie xx – In Waves', href: '/album/x' }).url,
    'https://www.tonspion.de/album/x'
  );
  assert.strictEqual(alsAlbum({ text: 'Jamie xx – In Waves', href: 'javascript:alert(1)' }).url, null);
});

test('alsAlbum kommt mit kurzen Künstlernamen zurecht, nicht aber mit Zahlenpaaren', () => {
  assert.strictEqual(alsAlbum({ text: 'M – Album', href: null }).interpret, 'M');
  assert.strictEqual(alsAlbum({ text: '!!! – Let It Be Blue', href: null }).interpret, '!!!');
  assert.strictEqual(alsAlbum({ text: '5 - 10 Euro', href: null }), null);
});

test('extrahiereAlben liest die Liste und entfernt Dubletten', () => {
  const alben = extrahiereAlben(SEITE);
  assert.deepStrictEqual(
    alben.map((a) => a.interpret),
    ['Fontaines D.C.', 'Beth Gibbons', 'Jamie xx', 'Tocotronic'],
    'Dublette und Newsletter-Zeile dürfen nicht auftauchen'
  );
  assert.strictEqual(alben[0].url, 'https://www.tonspion.de/album/fontaines-dc-romance');
  assert.strictEqual(alben[1].info, 'Domino');
});

test('extrahiereAlben scheitert laut, wenn das Markup nicht mehr passt', () => {
  // Genau der gefährliche Fall: die Seite antwortet, aber es ist nichts Erkennbares darin.
  // Eine leere Liste würde wie "diese Woche erscheint nichts" aussehen.
  assert.throws(
    () => extrahiereAlben('<html><body><main><article><h2>Neue Alben am 14.08.2026</h2>'
      + '<div>Wir haben umgebaut, die Liste steht jetzt woanders und zwar an einer ganz anderen '
      + 'Stelle dieser Seite.</div></article></main></body></html>'),
    /keine Albumzeilen erkannt/
  );
});

// ---------- Cover ----------

test('passenderTreffer akzeptiert Schreibvarianten, nicht aber fremde Interpreten', () => {
  assert.ok(passenderTreffer({ artistName: 'Fontaines D.C.' }, 'Fontaines D.C.'));
  assert.ok(passenderTreffer({ artistName: 'Sigur Rós' }, 'Sigur Ros'), 'Akzente dürfen egal sein');
  assert.ok(passenderTreffer({ artistName: 'Jamie xx' }, 'JAMIE XX'));
  assert.ok(!passenderTreffer({ artistName: 'Karaoke Allstars' }, 'Beth Gibbons'));
  assert.ok(!passenderTreffer({ artistName: '' }, 'Beth Gibbons'));
  assert.ok(!passenderTreffer(null, 'Beth Gibbons'));
});

test('coverSucheUrl fragt nach Alben, nicht nach Einzeltiteln', () => {
  const url = coverSucheUrl({ interpret: 'Beth Gibbons', titel: 'Lives Outgrown' });
  assert.ok(url.startsWith('https://itunes.apple.com/search?'));
  assert.ok(url.includes('entity=album'));
  assert.ok(url.includes(encodeURIComponent('Beth Gibbons Lives Outgrown')));
});

test('holeCover liefert ein größeres Bild und prüft den Interpreten', async () => {
  globalThis.fetch = async () => itunesTreffer('Beth Gibbons', 'https://is1.mzstatic.com/x/100x100bb.jpg');
  const cover = await holeCover({ interpret: 'Beth Gibbons', titel: 'Lives Outgrown' });
  assert.strictEqual(cover, 'https://is1.mzstatic.com/x/400x400bb.jpg');

  globalThis.fetch = async () => itunesTreffer('Irgendein Coverband', 'https://is1.mzstatic.com/x/100x100bb.jpg');
  const falsch = await holeCover({ interpret: 'Beth Gibbons', titel: 'Lives Outgrown' });
  assert.strictEqual(falsch, null, 'lieber kein Cover als das falsche');
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
    if (String(url).includes('itunes')) return itunesTreffer('Fontaines D.C.', 'https://is1.mzstatic.com/z/100x100bb.jpg');
    throw new Error(`Unerwarteter Abruf im Test: ${url}`);
  };

  const daten = await erstelleAlbenliste();
  assert.strictEqual(daten.datum, '2026-08-14');
  assert.strictEqual(daten.datumLesbar, 'Freitag, 14.08.2026');
  assert.strictEqual(daten.quelle, QUELLE);
  assert.ok(Date.parse(daten.generiertAm), 'generiertAm muss ein gültiger Zeitstempel sein');
  assert.strictEqual(daten.alben.length, 4);

  // Nur der passende Interpret bekommt das Cover, die übrigen bleiben ohne - aber vorhanden.
  assert.strictEqual(daten.alben[0].coverUrl, 'https://is1.mzstatic.com/z/400x400bb.jpg');
  assert.strictEqual(daten.alben[1].coverUrl, null);
});

test('erstelleAlbenliste meldet einen HTTP-Fehler der Quelle', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => erstelleAlbenliste(), /tonspion\.de: HTTP 503/);
});
