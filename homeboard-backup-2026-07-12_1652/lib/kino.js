'use strict';

const { chromium } = require('playwright');

// ---------- Hilfsfunktionen ----------

function heuteISO() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sortByFirstTime(a, b) {
  return (a.zeiten[0] || '').localeCompare(b.zeiten[0] || '');
}

// ---------- CineStar Magdeburg ----------
// Nutzt die offene JSON-API des Kinos direkt.

async function holeCineStar(heute) {
  const url = 'https://www.cinestar.de/api/cinema/37/show/?appVersion=1.5.3';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CineStar API: HTTP ${res.status}`);
  const eintraege = await res.json();

  const filme = [];
  for (const eintrag of eintraege) {
    const zeiten = (eintrag.showtimes || [])
      .filter((s) => typeof s.datetime === 'string' && s.datetime.startsWith(heute))
      .map((s) => s.datetime.slice(11, 16))
      .sort();
    if (zeiten.length > 0) {
      filme.push({ titel: eintrag.title, info: eintrag.subtitle || '', zeiten });
    }
  }
  filme.sort(sortByFirstTime);
  return filme;
}

// ---------- CinemaxX Magdeburg ----------
// Nutzt die offene Showings-Microservice-API direkt.

async function holeCinemaxx(heute) {
  const url = `https://www.cinemaxx.de/api/microservice/showings/cinemas/1391/films?showingDate=${heute}T00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CinemaxX API: HTTP ${res.status}`);
  const data = await res.json();

  const filme = [];
  for (const film of data.result || []) {
    const zeiten = [];
    for (const gruppe of film.showingGroups || []) {
      for (const session of gruppe.sessions || []) {
        if (typeof session.startTime === 'string' && session.startTime.startsWith(heute)) {
          zeiten.push(session.startTime.slice(11, 16));
        }
      }
    }
    if (zeiten.length > 0) {
      zeiten.sort();
      filme.push({ titel: (film.filmTitle || '').trim(), info: (film.genres || []).join(', '), zeiten });
    }
  }
  filme.sort(sortByFirstTime);
  return filme;
}

// ---------- Studiokino Magdeburg ----------
// Programm steht direkt im statischen HTML der Startseite.

async function holeStudiokino() {
  const res = await fetch('https://www.studiokino.com', { headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`Studiokino: HTTP ${res.status}`);
  const html = await res.text();

  const heuteStart = html.indexOf('Programm Heute');
  const demnaechstStart = html.indexOf('Demnächst', heuteStart);
  const abschnitt = html.slice(heuteStart, demnaechstStart > -1 ? demnaechstStart : undefined);

  const filme = [];
  const artikelRegex = /<article class="aktuell">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = artikelRegex.exec(abschnitt)) !== null) {
    const block = m[1];
    const titelMatch = block.match(/<h2>\s*<a[^>]*>(.*?)<\/a>/);
    const genreMatch = block.match(/<dt>Genre<\/dt>\s*<dd>(.*?)<\/dd>/);
    const fskMatch = block.match(/<dt>FSK<\/dt>\s*<dd>(.*?)<\/dd>/);
    if (titelMatch) {
      const infoTeile = [genreMatch && genreMatch[1].trim(), fskMatch && fskMatch[1].trim()].filter(Boolean);
      filme.push({
        titel: titelMatch[1].replace(/&#8211;/g, '–').replace(/&amp;/g, '&').trim(),
        info: infoTeile.join(', '),
        zeiten: [],
      });
    }
  }
  return filme;
}

// ---------- Moritzhof Magdeburg ----------
// Das Programm wird per JavaScript (Finsweet-Liste mit Infinite-Scroll) geladen,
// daher wird hier ein Headless-Browser (Playwright) benötigt.

async function holeMoritzhof(heute) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('https://www.moritzhof-magdeburg.de/programm', {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    let vorherigeAnzahl = -1;
    let stabilCount = 0;
    for (let i = 0; i < 40 && stabilCount < 3; i++) {
      const anzahl = await page.evaluate(() => document.querySelectorAll('.program_item').length);
      if (anzahl === vorherigeAnzahl) {
        stabilCount++;
      } else {
        stabilCount = 0;
      }
      vorherigeAnzahl = anzahl;
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(600);
    }

    const events = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.program_item')).map((item) => {
        const datum = item.querySelector('[fs-list-field="date"]');
        const kategorie = item.querySelector('[fs-list-field="category"]');
        const titel = item.querySelector('.program_title');
        return {
          datum: datum ? datum.textContent.trim() : '',
          kategorie: kategorie ? kategorie.textContent.trim() : '',
          titel: titel ? titel.textContent.trim() : '',
        };
      });
    });

    const filme = events
      .filter((e) => e.datum.startsWith(heute) && e.kategorie.toLowerCase().includes('kino'))
      .map((e) => ({ titel: e.titel, info: '', zeiten: [e.datum.slice(11)] }));

    const nachTitel = new Map();
    for (const f of filme) {
      if (!nachTitel.has(f.titel)) nachTitel.set(f.titel, { titel: f.titel, info: '', zeiten: [] });
      nachTitel.get(f.titel).zeiten.push(...f.zeiten);
    }
    const ergebnis = Array.from(nachTitel.values());
    ergebnis.forEach((f) => f.zeiten.sort());
    ergebnis.sort(sortByFirstTime);
    return ergebnis;
  } finally {
    await browser.close();
  }
}

// ---------- Öffentliche API des Moduls ----------

const KINOS = [
  { id: 'cinestar', name: 'CineStar Magdeburg', url: 'https://www.cinestar.de/kino-magdeburg', fn: holeCineStar },
  {
    id: 'cinemaxx',
    name: 'CinemaxX Magdeburg',
    url: 'https://www.cinemaxx.de/kinoprogramm/magdeburg/jetzt-im-kino',
    fn: holeCinemaxx,
  },
  { id: 'studiokino', name: 'Studiokino Magdeburg', url: 'https://www.studiokino.com', fn: (heute) => holeStudiokino(heute) },
  { id: 'moritzhof', name: 'Moritzhof Magdeburg', url: 'https://www.moritzhof-magdeburg.de', fn: holeMoritzhof },
];

async function erstelleKinoprogramm() {
  const heute = heuteISO();
  const datumLesbar = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());

  const kinos = [];
  for (const kino of KINOS) {
    try {
      const filme = await kino.fn(heute);
      kinos.push({ id: kino.id, name: kino.name, url: kino.url, filme, fehler: null });
    } catch (err) {
      kinos.push({ id: kino.id, name: kino.name, url: kino.url, filme: [], fehler: err.message });
    }
  }

  return {
    datum: heute,
    datumLesbar,
    generiertAm: new Date().toISOString(),
    kinos,
  };
}

module.exports = { erstelleKinoprogramm };
