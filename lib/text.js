'use strict';

// Textwerkzeuge, die sowohl das Kino- als auch das Musik-Scraping braucht. Sie standen
// ursprünglich in lib/kino.js; mit der zweiten HTML-Quelle wären sie dort doppelt gepflegt.

// Von Fremdseiten übernommene Links landen im Frontend als href oder src. Nur http/https
// zulassen, damit ein manipuliertes oder geändertes Fremdattribut kein "javascript:"
// einschleusen kann.
function sichereUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const geprueft = new URL(url);
    return geprueft.protocol === 'http:' || geprueft.protocol === 'https:' ? geprueft.href : null;
  } catch (e) {
    return null; // relativ oder unparsbar -> verwerfen
  }
}

function kuerzeBeschreibung(text, maxLaenge = 220) {
  if (!text) return '';
  const bereinigt = text.replace(/\s+/g, ' ').trim();
  if (bereinigt.length <= maxLaenge) return bereinigt;
  const abgeschnitten = bereinigt.slice(0, maxLaenge);
  const letztesLeerzeichen = abgeschnitten.lastIndexOf(' ');
  return abgeschnitten.slice(0, letztesLeerzeichen > 0 ? letztesLeerzeichen : maxLaenge) + '…';
}

// Häufige benannte HTML-Entities. Numerische Entities (&#8211; / &#x2013;) werden generisch
// über den Codepoint aufgelöst, benannte brauchen diese Tabelle.
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  euro: '€',
  szlig: 'ß',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
};

function dekodiereEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dez) => String.fromCodePoint(parseInt(dez, 10)))
    .replace(/&([a-zA-Z]+);/g, (treffer, name) => (name in ENTITIES ? ENTITIES[name] : treffer));
}

// Kleinster Fundort einer der Varianten ab Position ab, oder -1.
function ersterIndex(text, varianten, ab = 0) {
  const treffer = varianten.map((v) => text.indexOf(v, ab)).filter((i) => i > -1);
  return treffer.length ? Math.min(...treffer) : -1;
}

function stripHtmlTags(html) {
  return dekodiereEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// script/style enthalten Text, der beim Parsen wie Inhalt aussieht (JSON-Blobs, CSS-Regeln).
// Vor jeder Auswertung entfernen, sonst landet Konfigurationskram in den Ergebnissen.
function ohneSkripte(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

module.exports = {
  sichereUrl,
  kuerzeBeschreibung,
  dekodiereEntities,
  ersterIndex,
  stripHtmlTags,
  ohneSkripte,
  ENTITIES,
};
