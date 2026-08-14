'use strict';

const { holeMitTimeout } = require('./http');
const { lesbaresDatum, heuteISO } = require('./datum');
const { sichereUrl, stripHtmlTags, ohneSkripte } = require('./text');

// tonspion führt die Neuerscheinungen als Monatsübersicht: unter einer Monatsüberschrift folgen
// mehrere Datumszeilen ("14.08.26"), darunter jeweils die Alben dieses Freitags - auch schon
// die der kommenden Wochen. Deshalb wird die Seite in Datumsabschnitte zerlegt und daraus der
// jüngste bereits erschienene gewählt. Das Datum stammt immer aus der Seite, es wird nie selbst
// ausgerechnet: steht dort noch der letzte Freitag, zeigt das Homeboard auch den letzten Freitag.
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

function alsISO(tag, monat, jahr) {
  const t = Number(tag);
  const m = Number(monat);
  // Die Quelle schreibt das Jahr zweistellig ("14.08.26").
  const j = String(jahr).length <= 2 ? 2000 + Number(jahr) : Number(jahr);
  if (!(j >= 2000 && j <= 2100) || !(m >= 1 && m <= 12) || !(t >= 1 && t <= 31)) return null;
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

// Eine Datumszeile enthält nur das Datum, sonst nichts - ein Datum mitten im Fließtext soll
// keinen neuen Abschnitt aufmachen. Ein vorangestellter Wochentag ist erlaubt.
function datumAusZeile(text) {
  const treffer = String(text).trim().match(/^(?:[A-Za-zÄÖÜäöü]+,\s*)?(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})\.?$/);
  if (!treffer) return null;
  return alsISO(treffer[1], treffer[2], treffer[3]);
}

// ---------- Seite in Zeilen zerlegen ----------

// Kopf- und Fußbereiche enthalten ebenfalls Textzeilen. Wenn die Seite einen Artikelbereich
// auszeichnet, nur darin suchen.
function artikelBereich(html) {
  const sauber = ohneSkripte(html);
  const artikel = sauber.match(/<article\b[\s\S]*?<\/article>/i);
  if (artikel && artikel[0].length > 500) return artikel[0];
  const haupt = sauber.match(/<main\b[\s\S]*?<\/main>/i);
  if (haupt && haupt[0].length > 500) return haupt[0];
  return sauber;
}

// Die Albumzeilen können als eigene Absätze oder als eine mit <br> umbrochene Liste stehen -
// beides kommt auf solchen Seiten vor. Deshalb wird an allen zeilenbildenden Tags getrennt,
// statt sich auf ein bestimmtes Element festzulegen.
function inZeilen(bereich) {
  return bereich
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|li|h[1-6]|div|tr|td|section|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .split('\n')
    .map((roh) => {
      const link = roh.match(/<a\b[^>]*href="([^"]+)"/i);
      return { text: stripHtmlTags(roh), href: link ? link[1] : null };
    })
    .filter((zeile) => zeile.text.length > 0);
}

// ---------- Albumzeilen ----------

const AUSSCHLUSS = /cookie|newsletter|datenschutz|impressum|anzeige|werbung|abonn|folge uns|mehr erfahren|jetzt lesen|mixtape|im überblick|alle rechte/i;

// "Interpret – Albumtitel (Label)" -> Bestandteile. Getrennt wird an der ersten Strich-Variante
// mit Leerzeichen drumherum; Striche im Albumtitel bleiben dadurch erhalten. Manche Zeilen der
// Quelle haben gar keinen Trenner ("Dent May The Big One") - die bleiben als ganze Zeile stehen,
// denn ein geratener Schnitt wäre schlechter als ein ungetrennter Eintrag.
function alsAlbum(zeile) {
  const text = zeile.text.replace(/^\s*\d{1,2}[.)]\s+/, '').trim(); // führende Aufzählung
  if (!text || text.length > 140 || AUSSCHLUSS.test(text)) return null;
  if (datumAusZeile(text)) return null;
  // Fließtext statt Listeneintrag: endet mit Satzzeichen oder ist auffällig wortreich.
  if (/[.:;!?]$/.test(text) || text.split(/\s+/).length > 14) return null;

  let url = null;
  if (zeile.href) {
    try {
      url = sichereUrl(new URL(zeile.href, QUELLE).href);
    } catch (e) {
      url = null;
    }
  }

  const teile = text.match(/^(.{1,80}?)\s+[–—-]\s+(.{1,90})$/);
  if (!teile) {
    // Ohne Trenner: die ganze Zeile ist der Eintrag. Muss trotzdem nach einem Albumnamen
    // aussehen - eine reine Zahl oder ein einzelnes Wort ohne Buchstaben ist keiner.
    if (!/[A-Za-zÄÖÜäöüß]/.test(text)) return null;
    return { interpret: text, titel: null, info: null, url, coverUrl: null };
  }

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

  return { interpret, titel, info, url, coverUrl: null };
}

// ---------- Abschnitte ----------

// Jede Datumszeile eröffnet einen Abschnitt; alles bis zur nächsten Datumszeile gehört dazu.
// Zeilen vor der ersten Datumszeile (Navigation, Monatsüberschrift, Anreißer) fallen weg.
function abschnitte(html) {
  const gefunden = [];
  let aktuell = null;

  for (const zeile of inZeilen(artikelBereich(html))) {
    const datum = datumAusZeile(zeile.text);
    if (datum) {
      aktuell = { datum, alben: [], gesehen: new Set() };
      gefunden.push(aktuell);
      continue;
    }
    if (!aktuell) continue;

    const album = alsAlbum(zeile);
    if (!album) continue;
    const schluessel = (album.interpret + '|' + (album.titel || '')).toLowerCase();
    if (aktuell.gesehen.has(schluessel)) continue;
    aktuell.gesehen.add(schluessel);
    aktuell.alben.push(album);
  }

  return gefunden.map(({ datum, alben }) => ({ datum, alben }));
}

// Der jüngste Abschnitt, der nicht in der Zukunft liegt - die Seite kündigt auch kommende
// Freitage an, und die sind noch nicht erschienen. Gibt es nur Zukünftiges (etwa Anfang eines
// neuen Monats), wird der nächstliegende genommen, damit die Kachel nicht leer bleibt.
function waehleAbschnitt(liste, heute) {
  const mitAlben = liste.filter((a) => a.alben.length > 0);
  if (mitAlben.length === 0) return null;

  const erschienen = mitAlben.filter((a) => a.datum <= heute);
  if (erschienen.length > 0) {
    return erschienen.reduce((a, b) => (b.datum > a.datum ? b : a));
  }
  return mitAlben.reduce((a, b) => (b.datum < a.datum ? b : a));
}

function erstelleAbschnitt(html, heute = heuteISO()) {
  const liste = abschnitte(html);

  // Laut scheitern: ohne Datumsabschnitt oder ohne eine einzige Albumzeile ist die Seite nicht
  // mehr die, für die dieser Parser geschrieben wurde. Eine leere Liste zurückzugeben sähe aus
  // wie "diese Woche erscheint nichts" und wäre die gefährlichere Antwort.
  if (liste.length === 0) {
    throw new Error('tonspion: keine Datumsabschnitte gefunden - vermutlich hat sich das Seitenlayout geändert');
  }
  const gewaehlt = waehleAbschnitt(liste, heute);
  if (!gewaehlt) {
    throw new Error(
      `tonspion: ${liste.length} Datumsabschnitte gefunden, aber keine Albumzeilen darin - vermutlich hat sich das Seitenlayout geändert`
    );
  }

  if (gewaehlt.alben.length > MAX_ALBEN) {
    console.warn(`tonspion: ${gewaehlt.alben.length} Einträge für ${gewaehlt.datum}, es werden die ersten ${MAX_ALBEN} angezeigt.`);
    return { datum: gewaehlt.datum, alben: gewaehlt.alben.slice(0, MAX_ALBEN) };
  }
  return gewaehlt;
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
// deshalb muss der Interpretenname des Treffers zum gesuchten passen. Bei Zeilen ohne Trenner
// steht der ganze Text im Feld interpret - dann greift die Teilstring-Prüfung ebenfalls.
function passenderTreffer(treffer, interpret) {
  const gefunden = normalisiereName(treffer && treffer.artistName);
  const gesucht = normalisiereName(interpret);
  if (!gefunden || !gesucht) return false;
  return gefunden.includes(gesucht) || gesucht.includes(gefunden);
}

function coverSucheUrl(album) {
  const begriff = album.titel ? `${album.interpret} ${album.titel}` : album.interpret;
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
  const { datum, alben } = erstelleAbschnitt(html);

  return {
    datum,
    datumLesbar: lesbaresDatum(datum),
    quelle: QUELLE,
    generiertAm: new Date().toISOString(),
    alben: await ergaenzeCover(alben),
  };
}

module.exports = {
  erstelleAlbenliste,
  QUELLE,
  MAX_ALBEN,
  _intern: {
    datumAusZeile,
    artikelBereich,
    inZeilen,
    alsAlbum,
    abschnitte,
    waehleAbschnitt,
    erstelleAbschnitt,
    normalisiereName,
    passenderTreffer,
    coverSucheUrl,
    holeCover,
    ergaenzeCover,
  },
};
