'use strict';

const { holeMitTimeout } = require('./http');
const { lesbaresDatum } = require('./datum');
const { sichereUrl, stripHtmlTags, ohneSkripte } = require('./text');

// tonspion veröffentlicht die Neuerscheinungen der Woche in einem Artikel, der freitags
// fortgeschrieben wird. Das Datum in dessen Überschrift ist die verbindliche Angabe - es wird
// gelesen und nie selbst berechnet. Steht dort noch der letzte Freitag, zeigt das Homeboard
// auch den letzten Freitag, statt alte Alben als neu auszugeben.
const QUELLE = 'https://www.tonspion.de/news/musik-neuerscheinungen-neue-alben';

const SEITE_TIMEOUT_MS = 15000;
const COVER_TIMEOUT_MS = 6000;
// Die iTunes-Suche ist ein unangemeldeter Dienst mit Ratenbegrenzung. Vier gleichzeitige
// Abrufe halten eine Wochenliste in wenigen Sekunden fertig, ohne dort aufzufallen.
const COVER_GLEICHZEITIG = 4;
const MAX_ALBEN = 80;

const BROWSER_KENNUNG =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------- Datum ----------

const MONATE = {
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

function alsISO(jahr, monat, tag) {
  const j = Number(jahr);
  const m = Number(monat);
  const t = Number(tag);
  if (!(j >= 2000 && j <= 2100) || !(m >= 1 && m <= 12) || !(t >= 1 && t <= 31)) return null;
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

// Erkennt "14.08.2026", "14. 8. 2026" und "14. August 2026".
function datumAusText(text) {
  const numerisch = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (numerisch) return alsISO(numerisch[3], numerisch[2], numerisch[1]);

  const ausgeschrieben = text.match(/(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/);
  if (ausgeschrieben) {
    const monat = MONATE[ausgeschrieben[2].toLowerCase()];
    if (monat) return alsISO(ausgeschrieben[3], monat, ausgeschrieben[1]);
  }
  return null;
}

// Reihenfolge nach Verlässlichkeit: erst eine Überschrift, die erkennbar von den Alben handelt,
// dann irgendeine Überschrift mit Datum, zuletzt das <time>-Element. Letzteres trägt oft das
// Veröffentlichungsdatum des Artikels und nicht das der Alben - deshalb nur als Notnagel.
function datumAusSeite(html) {
  const ueberschriften = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => stripHtmlTags(m[2]));
  const themenbezogen = ueberschriften.filter((t) => /alben|neuerscheinung|release/i.test(t));

  for (const gruppe of [themenbezogen, ueberschriften]) {
    for (const text of gruppe) {
      const iso = datumAusText(text);
      if (iso) return iso;
    }
  }

  const zeit = html.match(/<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})/i);
  if (zeit) return zeit[1];

  throw new Error(
    `tonspion: kein Erscheinungsdatum gefunden (${ueberschriften.length} Überschriften geprüft) - vermutlich hat sich das Seitenlayout geändert`
  );
}

// ---------- Albumliste ----------

// Kopf- und Fußbereiche enthalten ebenfalls Textblöcke mit Bindestrichen. Wenn die Seite einen
// Artikelbereich auszeichnet, nur darin suchen.
function artikelBereich(html) {
  const sauber = ohneSkripte(html);
  const artikel = sauber.match(/<article\b[\s\S]*?<\/article>/i);
  if (artikel && artikel[0].length > 500) return artikel[0];
  const haupt = sauber.match(/<main\b[\s\S]*?<\/main>/i);
  if (haupt && haupt[0].length > 500) return haupt[0];
  return sauber;
}

// Textblöcke, die einen Albumeintrag enthalten könnten - mitsamt dem ersten Link darin.
function textbloecke(bereich) {
  const bloecke = [];
  const regex = /<(li|h2|h3|h4|p|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let treffer;
  while ((treffer = regex.exec(bereich)) !== null) {
    const innen = treffer[2];
    // Verschachtelte Container liefern denselben Text noch einmal, nur mit mehr Beiwerk.
    if (/<(?:li|h2|h3|h4|p)\b/i.test(innen)) continue;
    const link = innen.match(/<a\b[^>]*href="([^"]+)"/i);
    bloecke.push({ text: stripHtmlTags(innen), href: link ? link[1] : null });
  }
  return bloecke;
}

const AUSSCHLUSS = /cookie|newsletter|datenschutz|impressum|anzeige|werbung|abonn|folge uns|mehr erfahren|jetzt lesen/i;

// "Interpret – Albumtitel (Label)" -> Bestandteile. Getrennt wird an der ersten Strich-Variante
// mit Leerzeichen drumherum; Striche im Albumtitel bleiben dadurch erhalten.
function alsAlbum(block) {
  const text = block.text.replace(/^\s*\d{1,2}[.)]\s+/, '').trim(); // führende Aufzählung
  if (!text || text.length > 140 || AUSSCHLUSS.test(text)) return null;

  const teile = text.match(/^(.{1,80}?)\s+[–—-]\s+(.{1,90})$/);
  if (!teile) return null;

  const interpret = teile[1].trim();
  let titel = teile[2].trim();
  let info = null;

  // Ein kurzer Klammerzusatz am Ende ist bei solchen Listen üblicherweise Label oder Genre.
  const klammer = titel.match(/^(.+?)\s*\(([^()]{2,30})\)$/);
  if (klammer && klammer[2].trim().split(/\s+/).length <= 4) {
    titel = klammer[1].trim();
    info = klammer[2].trim();
  }

  // Ein Interpret darf einbuchstabig heißen ("M") oder aus Zeichen bestehen ("!!!"), aber eine
  // reine Zahl ist keiner - so fällt "5 - 10 Euro" aus einem Fließtext wieder heraus.
  if (!interpret || (/\d/.test(interpret) && !/[A-Za-zÄÖÜäöüß]/.test(interpret))) return null;
  if (!/[A-Za-zÄÖÜäöüß0-9]/.test(titel)) return null;

  let url = null;
  if (block.href) {
    try {
      url = sichereUrl(new URL(block.href, QUELLE).href);
    } catch (e) {
      url = null;
    }
  }

  return { interpret, titel, info, url, coverUrl: null };
}

function extrahiereAlben(html) {
  const bloecke = textbloecke(artikelBereich(html));
  const alben = [];
  const gesehen = new Set();

  for (const block of bloecke) {
    const album = alsAlbum(block);
    if (!album) continue;
    const schluessel = (album.interpret + '|' + album.titel).toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    alben.push(album);
  }

  // Laut scheitern: eine leere Liste ist bei einem wöchentlich gepflegten Artikel kein
  // plausibles Ergebnis, sondern ein Zeichen dafür, dass das Markup nicht mehr passt.
  if (alben.length === 0) {
    throw new Error(
      `tonspion: keine Albumzeilen erkannt (${bloecke.length} Textblöcke geprüft) - vermutlich hat sich das Seitenlayout geändert`
    );
  }

  if (alben.length > MAX_ALBEN) {
    console.warn(`tonspion: ${alben.length} Einträge erkannt, es werden die ersten ${MAX_ALBEN} angezeigt.`);
    return alben.slice(0, MAX_ALBEN);
  }
  return alben;
}

// ---------- Cover ----------

function normalisiereName(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    // Akzente nach der Zerlegung entfernen. Bewusst als \u-Escapes und nicht als rohe
    // Kombinationszeichen: die stünden sonst unsichtbar in der Datei und würden bei einer
    // Umkodierung (Kopie über Windows-Freigaben, Editor mit anderer Zeichensatzeinstellung)
    // zu einem kaputten Bereich - der Server startete dann gar nicht mehr.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Die Suche liefert auch Tribute-Alben und Namensvettern. Lieber kein Cover als das falsche,
// deshalb muss der Interpretenname des Treffers zum gesuchten passen.
function passenderTreffer(treffer, interpret) {
  const gefunden = normalisiereName(treffer && treffer.artistName);
  const gesucht = normalisiereName(interpret);
  if (!gefunden || !gesucht) return false;
  return gefunden.includes(gesucht) || gesucht.includes(gefunden);
}

function coverSucheUrl(album) {
  const begriff = `${album.interpret} ${album.titel}`;
  return `https://itunes.apple.com/search?country=DE&media=music&entity=album&limit=5&term=${encodeURIComponent(begriff)}`;
}

async function holeCover(album) {
  const res = await holeMitTimeout(coverSucheUrl(album), { headers: { accept: 'application/json' } }, COVER_TIMEOUT_MS);
  if (!res.ok) throw new Error(`iTunes-Suche: HTTP ${res.status}`);
  const daten = await res.json();
  const treffer = (daten && Array.isArray(daten.results) ? daten.results : []).find((t) => passenderTreffer(t, album.interpret));
  if (!treffer || !treffer.artworkUrl100) return null;
  // Dieselbe Adresse liefert unter anderem Maß ein größeres Bild - 100px wären auf dem Tablet
  // sichtbar unscharf.
  return sichereUrl(String(treffer.artworkUrl100).replace('100x100bb', '400x400bb'));
}

async function ergaenzeCover(alben) {
  let naechster = 0;
  async function arbeiter() {
    while (naechster < alben.length) {
      const album = alben[naechster++];
      try {
        album.coverUrl = await holeCover(album);
      } catch (e) {
        // Ein fehlendes Cover ist kein Grund, das Album zu verschweigen - das Frontend zeigt
        // dann einen Platzhalter in gleicher Größe.
        album.coverUrl = null;
      }
    }
  }
  const arbeiterZahl = Math.min(COVER_GLEICHZEITIG, alben.length);
  await Promise.all(Array.from({ length: arbeiterZahl }, () => arbeiter()));
  return alben;
}

// ---------- Zusammenbau ----------

async function holeSeite() {
  const res = await holeMitTimeout(
    QUELLE,
    { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': BROWSER_KENNUNG } },
    SEITE_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`tonspion.de: HTTP ${res.status}`);
  return res.text();
}

async function erstelleAlbenliste() {
  const html = await holeSeite();
  const datum = datumAusSeite(html);
  const alben = await ergaenzeCover(extrahiereAlben(html));

  return {
    datum,
    datumLesbar: lesbaresDatum(datum),
    quelle: QUELLE,
    generiertAm: new Date().toISOString(),
    alben,
  };
}

module.exports = {
  erstelleAlbenliste,
  QUELLE,
  MAX_ALBEN,
  _intern: {
    datumAusText,
    datumAusSeite,
    artikelBereich,
    textbloecke,
    alsAlbum,
    extrahiereAlben,
    normalisiereName,
    passenderTreffer,
    coverSucheUrl,
    holeCover,
    ergaenzeCover,
  },
};
