'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { _intern } = require('../lib/kino');
const { tagISO, heuteISO, morgenISO, lesbaresDatum } = require('../lib/datum');

const { sichereUrl, dekodiereEntities, stripHtmlTags, kuerzeBeschreibung, normalisiereErgebnis } = _intern;

test('sichereUrl lässt nur http und https durch', () => {
  assert.strictEqual(sichereUrl('https://www.youtube.com/watch?v=1'), 'https://www.youtube.com/watch?v=1');
  assert.strictEqual(sichereUrl('http://example.org/'), 'http://example.org/');

  for (const boese of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
    assert.strictEqual(sichereUrl(boese), null, `${boese} hätte verworfen werden müssen`);
  }
});

test('sichereUrl verwirft alles, was keine absolute URL ist', () => {
  assert.strictEqual(sichereUrl('/relativ/pfad'), null);
  assert.strictEqual(sichereUrl(''), null);
  assert.strictEqual(sichereUrl(null), null);
  assert.strictEqual(sichereUrl(undefined), null);
  assert.strictEqual(sichereUrl(42), null);
});

test('dekodiereEntities löst benannte und numerische Entities auf', () => {
  assert.strictEqual(dekodiereEntities('Caf&eacute;s &amp; Kinos'), 'Caf&eacute;s & Kinos'); // unbekannte bleiben stehen
  assert.strictEqual(dekodiereEntities('&quot;Titel&quot;'), '"Titel"');
  assert.strictEqual(dekodiereEntities('&#8220;Titel&#8221;'), '“Titel”');
  assert.strictEqual(dekodiereEntities('&#x2013;'), '–');
  assert.strictEqual(dekodiereEntities('Gr&uuml;&szlig;e'), 'Grüße');
});

test('stripHtmlTags entfernt Markup und normalisiert Leerraum', () => {
  assert.strictEqual(stripHtmlTags('<p>Ein <b>guter</b>   Film</p>'), 'Ein guter Film');
  assert.strictEqual(stripHtmlTags('<p>A &ndash; B</p>'), 'A – B');
  assert.strictEqual(stripHtmlTags(''), '');
});

test('kuerzeBeschreibung kürzt an der Wortgrenze', () => {
  assert.strictEqual(kuerzeBeschreibung(''), '');
  assert.strictEqual(kuerzeBeschreibung('kurz'), 'kurz');

  const lang = 'Wort '.repeat(100);
  const gekuerzt = kuerzeBeschreibung(lang, 40);
  assert.ok(gekuerzt.length <= 41, `zu lang: ${gekuerzt.length}`);
  assert.ok(gekuerzt.endsWith('…'));
  assert.ok(!gekuerzt.includes('  '));
});

test('normalisiereErgebnis akzeptiert Liste und Objekt', () => {
  assert.deepStrictEqual(normalisiereErgebnis([{ titel: 'A' }]), { filme: [{ titel: 'A' }], hinweis: null });
  assert.deepStrictEqual(normalisiereErgebnis({ filme: [], hinweis: 'kein Programm' }), { filme: [], hinweis: 'kein Programm' });
  assert.deepStrictEqual(normalisiereErgebnis({}), { filme: [], hinweis: null });
});

test('Datumshelfer liefern Berliner Kalendertage', () => {
  assert.match(heuteISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(morgenISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.notStrictEqual(heuteISO(), morgenISO());

  // Morgen ist genau ein Kalendertag nach heute.
  const abstand = (Date.parse(morgenISO() + 'T12:00:00Z') - Date.parse(heuteISO() + 'T12:00:00Z')) / 86400000;
  assert.strictEqual(abstand, 1);

  assert.strictEqual(tagISO(0), heuteISO());
  assert.match(lesbaresDatum('2026-08-15'), /^Samstag, 15\.08\.2026$/);
});
