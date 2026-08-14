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

// Einheitlicher Trailer-Fallback: keines der vier Kinos liefert zuverlässig einen direkten
// Trailer-Link für jeden Film (nur Moritzhof hat einen echten YouTube-Link auf der Detailseite,
// siehe holeMoritzhof). Statt pro Kino fragile Sonderlösungen zu bauen, die bei Seitenänderungen
// leicht brechen, führt der Trailer-Button hier zur YouTube-Suche zum Filmtitel.
function trailerSucheUrl(titel) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(titel + ' Trailer');
}

function kuerzeBeschreibung(text, maxLaenge = 220) {
  if (!text) return '';
  const bereinigt = text.replace(/\s+/g, ' ').trim();
  if (bereinigt.length <= maxLaenge) return bereinigt;
  const abgeschnitten = bereinigt.slice(0, maxLaenge);
  const letztesLeerzeichen = abgeschnitten.lastIndexOf(' ');
  return abgeschnitten.slice(0, letztesLeerzeichen > 0 ? letztesLeerzeichen : maxLaenge) + '…';
}

function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
      filme.push({
        titel: eintrag.title,
        info: eintrag.subtitle || '',
        zeiten,
        trailerUrl: trailerSucheUrl(eintrag.title),
        beschreibung: '',
        _movieId: eintrag.movie, // nur intern, wird unten wieder entfernt
      });
    }
  }

  // Kurzbeschreibung steckt nicht in der Show-Liste, sondern muss pro Film separat nachgeladen
  // werden (kleine, schnelle JSON-Anfrage, parallel für alle Filme).
  await Promise.all(
    filme.map(async (f) => {
      if (!f._movieId) return;
      try {
        const r = await fetch(`https://www.cinestar.de/api/movie/${f._movieId}/?appVersion=1.5.3`, {
          headers: { accept: 'application/json' },
        });
        if (r.ok) {
          const detail = await r.json();
          f.beschreibung = kuerzeBeschreibung(detail.teaser);
        }
      } catch (e) {
        // Kurzbeschreibung ist ein Bonus, kein Grund den ganzen Film wegzulassen
      }
    })
  );
  filme.forEach((f) => delete f._movieId);

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
      const titel = (film.filmTitle || '').trim();
      filme.push({
        titel,
        info: (film.genres || []).join(', '),
        zeiten,
        beschreibung: kuerzeBeschreibung(film.synopsisShort),
        trailerUrl: trailerSucheUrl(titel),
      });
    }
  }
  filme.sort(sortByFirstTime);
  return filme;
}

// ---------- Studiokino Magdeburg ----------
// Programm steht direkt im statischen HTML der Startseite; Kurzbeschreibung steht auf der
// jeweiligen Film-Detailseite (ebenfalls statisches HTML).

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
    const titelMatch = block.match(/<h2>\s*<a href="([^"]*)"[^>]*>(.*?)<\/a>/);
    const genreMatch = block.match(/<dt>Genre<\/dt>\s*<dd>(.*?)<\/dd>/);
    const fskMatch = block.match(/<dt>FSK<\/dt>\s*<dd>(.*?)<\/dd>/);
    if (titelMatch) {
      const infoTeile = [genreMatch && genreMatch[1].trim(), fskMatch && fskMatch[1].trim()].filter(Boolean);
      const titel = titelMatch[2].replace(/&#8211;/g, '–').replace(/&amp;/g, '&').trim();
      const href = titelMatch[1];
      filme.push({
        titel,
        info: infoTeile.join(', '),
        zeiten: [],
        trailerUrl: trailerSucheUrl(titel),
        beschreibung: '',
        _detailUrl: href.startsWith('http') ? href : 'https://www.studiokino.com' + href,
      });
    }
  }

  // Kurzbeschreibung von der Film-Detailseite nachladen (statisches HTML, keine Extra-Bibliothek nötig).
  await Promise.all(
    filme.map(async (f) => {
      try {
        const r = await fetch(f._detailUrl, { headers: { accept: 'text/html' } });
        if (r.ok) {
          const detailHtml = await r.text();
          const h1Ende = detailHtml.indexOf('</h1>');
          const credEnde = detailHtml.indexOf('kartenbestell', h1Ende);
          const bereich = detailHtml.slice(h1Ende, credEnde > -1 ? credEnde : undefined);
          const absaetze = [...bereich.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => stripHtmlTags(x[1]));
          // Der längste Absatz ist erfahrungsgemäß die eigentliche Inhaltsangabe
          // (kurze Absätze sind meist Datums-/Ankündigungshinweise).
          const laengster = absaetze.sort((a, b) => b.length - a.length)[0];
          if (laengster) f.beschreibung = kuerzeBeschreibung(laengster);
        }
      } catch (e) {
        // Kurzbeschreibung ist ein Bonus, kein Grund den ganzen Film wegzulassen
      }
    })
  );
  filme.forEach((f) => delete f._detailUrl);

  return filme;
}

// ---------- Moritzhof Magdeburg ----------
// Das Programm wird per JavaScript (Finsweet-Liste mit Infinite-Scroll) geladen,
// daher wird hier ein Headless-Browser (Playwright) benötigt. Die Detailseiten pro Film
// (Trailer + Inhaltsangabe) sind dagegen statisches HTML und lassen sich per fetch() nachladen.

async function holeMoritzhof(heute) {
  // In Containern (z.B. Docker/Unraid) läuft Chromium meist als root ohne funktionierende
  // Sandbox-Namespaces, und /dev/shm ist standardmäßig zu klein -> beides abschalten.
  // Wird über HOMEBOARD_DOCKER=1 im Dockerfile aktiviert, lokal (Windows-Entwicklung) bleibt
  // die volle Sandbox aktiv.
  const launchOptions =
    process.env.HOMEBOARD_DOCKER === '1' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {};
  const browser = await chromium.launch(launchOptions);
  let events;
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

    events = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.program_item')).map((item) => {
        const datum = item.querySelector('[fs-list-field="date"]');
        const kategorie = item.querySelector('[fs-list-field="category"]');
        const titel = item.querySelector('.program_title');
        const link = item.querySelector('a.program_link');
        return {
          datum: datum ? datum.textContent.trim() : '',
          kategorie: kategorie ? kategorie.textContent.trim() : '',
          titel: titel ? titel.textContent.trim() : '',
          href: link ? link.getAttribute('href') : null,
        };
      });
    });
  } finally {
    await browser.close();
  }

  const filme = events
    .filter((e) => e.datum.startsWith(heute) && e.kategorie.toLowerCase().includes('kino'))
    .map((e) => ({
      titel: e.titel,
      info: '',
      zeiten: [e.datum.slice(11)],
      href: e.href ? 'https://www.moritzhof-magdeburg.de' + e.href : null,
    }));

  const nachTitel = new Map();
  for (const f of filme) {
    if (!nachTitel.has(f.titel)) {
      nachTitel.set(f.titel, { titel: f.titel, info: '', zeiten: [], beschreibung: '', trailerUrl: trailerSucheUrl(f.titel), _href: f.href });
    }
    nachTitel.get(f.titel).zeiten.push(...f.zeiten);
  }
  const ergebnis = Array.from(nachTitel.values());
  ergebnis.forEach((f) => f.zeiten.sort());

  // Trailer + Inhaltsangabe stehen auf der Detailseite der jeweiligen Vorstellung
  // (echter YouTube-Link, kein Suche-Fallback nötig).
  await Promise.all(
    ergebnis.map(async (f) => {
      if (!f._href) return;
      try {
        const r = await fetch(f._href, { headers: { accept: 'text/html' } });
        if (r.ok) {
          const html = await r.text();
          const trailerMatch = html.match(/data-trailer-link="([^"]+)"/);
          if (trailerMatch) f.trailerUrl = trailerMatch[1];
          const textMatch = html.match(/class="[^"]*richtext[^"]*">([\s\S]*?)<\/div>/);
          if (textMatch) f.beschreibung = kuerzeBeschreibung(stripHtmlTags(textMatch[1]));
        }
      } catch (e) {
        // Trailer/Inhaltsangabe sind ein Bonus, kein Grund den ganzen Film wegzulassen
      }
    })
  );
  ergebnis.forEach((f) => delete f._href);

  ergebnis.sort(sortByFirstTime);
  return ergebnis;
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
