'use strict';

// ---------- Theme ----------
const THEME_KEY = 'appTheme';
function applyTheme(theme){
  if(theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('themeToggleBtn');
  if(btn){
    btn.textContent = theme === 'light' ? '☀ Hell' : '🌙 Dunkel';
    btn.title = theme === 'light' ? 'Zu Dunkelmodus wechseln (Alt+M)' : 'Zu Hellmodus wechseln (Alt+M)';
  }
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
}
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

// ---------- Kopf-Datum ----------
// Wird nicht nur einmal gesetzt: das Tablet läuft tagelang durch, ohne die Seite neu zu laden.
let kopfDatumTag = '';
function aktualisiereKopfDatum(){
  const jetzt = new Date();
  const tag = jetzt.toDateString();
  if(tag === kopfDatumTag) return false;
  kopfDatumTag = tag;
  document.getElementById('kopfDatum').textContent = jetzt.toLocaleDateString('de-DE', {
    weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'
  });
  return true; // Tageswechsel
}
aktualisiereKopfDatum();

// ---------- Gemeinsame Helfer ----------
function escapeHtml(text){
  return String(text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// escapeHtml sichert den Attributwert, nicht das URL-Schema: "javascript:..." enthält keines
// der maskierten Zeichen und käme unverändert durch. Links stammen teils aus Fremdseiten,
// daher hier nur http/https zulassen (der Server prüft zusätzlich, siehe sichereUrl).
function sichereUrl(url){
  try{
    const geprueft = new URL(url, location.href);
    return (geprueft.protocol === 'http:' || geprueft.protocol === 'https:') ? geprueft.href : null;
  }catch(e){
    return null;
  }
}

// "vor 12 Min." - macht sichtbar, wie alt der angezeigte Stand tatsächlich ist. Auf einem
// Wandtablet, das nie neu geladen wird, ist die reine Uhrzeit dafür zu leicht zu übersehen.
function relativesAlter(zeitpunkt){
  const ms = Date.now() - zeitpunkt.getTime();
  if(!isFinite(ms)) return '';
  if(ms < 0) return 'gerade eben';
  const minuten = Math.floor(ms / 60000);
  if(minuten < 1) return 'gerade eben';
  if(minuten < 60) return 'vor ' + minuten + ' Min.';
  const stunden = Math.floor(minuten / 60);
  if(stunden < 24) return 'vor ' + stunden + (stunden === 1 ? ' Stunde' : ' Stunden');
  const tage = Math.floor(stunden / 24);
  return 'vor ' + tage + (tage === 1 ? ' Tag' : ' Tagen');
}

// Merkt sich den Zeitpunkt am Element, damit der Ticker das Alter fortschreiben kann,
// ohne die Daten erneut zu holen.
function setzeStand(el, isoZeit, praefix){
  const zeitpunkt = new Date(isoZeit);
  if(isNaN(zeitpunkt.getTime())){ el.textContent = ''; return; }
  el.dataset.zeitpunkt = zeitpunkt.toISOString();
  el.dataset.praefix = praefix || '';
  zeichneStand(el);
}
function zeichneStand(el){
  const zeitpunkt = new Date(el.dataset.zeitpunkt);
  const uhrzeit = zeitpunkt.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  el.textContent = (el.dataset.praefix || '') + 'Stand: ' + uhrzeit + ' (' + relativesAlter(zeitpunkt) + ')';
}
function aktualisiereAlleStaende(){
  document.querySelectorAll('.stand[data-zeitpunkt]').forEach(zeichneStand);
}

// ---------- View-Navigation ----------
const VIEWS = ['home','kino','wetter','alben'];
let aktuelleView = 'home';
let wetterGeladen = false;
let albenGeladen = false;

function zeigeView(name){
  if(!VIEWS.includes(name)) return;
  aktuelleView = name;
  VIEWS.forEach(v => {
    document.getElementById('view-' + v).classList.toggle('active', v === name);
  });
  if(name === 'kino'){ ladeKinoprogramm(false, false); }
  if(name === 'wetter' && !wetterGeladen){ wetterGeladen = true; ladeWetter(false, false); }
  if(name === 'alben' && !albenGeladen){ albenGeladen = true; ladeAlben(false, false); }
}

document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', () => zeigeView(el.getAttribute('data-view')));
});

// ---------- Hilfe-Dialog ----------
const hilfeDialog = document.getElementById('hilfeDialog');
document.getElementById('hilfeBtn').addEventListener('click', () => hilfeDialog.showModal());
document.getElementById('hilfeSchliessenBtn').addEventListener('click', () => hilfeDialog.close());

function closeTopmostOverlay(){
  const offen = Array.from(document.querySelectorAll('dialog[open]'));
  if(offen.length){ offen[offen.length-1].close(); return true; }
  if(aktuelleView !== 'home'){ zeigeView('home'); return true; }
  return false;
}

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){ closeTopmostOverlay(); return; }
  if(e.key === '?' && !hilfeDialog.open){ hilfeDialog.showModal(); return; }
  if(e.altKey && (e.key === 'm' || e.key === 'M')){ e.preventDefault(); toggleTheme(); return; }
  if(e.altKey && (e.key === 'k' || e.key === 'K')){ e.preventDefault(); zeigeView('kino'); return; }
  if(e.altKey && (e.key === 'w' || e.key === 'W')){ e.preventDefault(); zeigeView('wetter'); return; }
  if(e.altKey && (e.key === 'a' || e.key === 'A')){ e.preventDefault(); zeigeView('alben'); return; }
  if(e.altKey && (e.key === 't' || e.key === 'T')){
    e.preventDefault();
    if(aktuelleView === 'kino') waehleKinoTag(kinoTag === 'heute' ? 'morgen' : 'heute');
    return;
  }
});

// ---------- Kinoprogramm ----------
let kinoTag = 'heute';
let kinoInhaltGefuellt = false;
let kinoGeladenUm = 0;

function renderKinoKarte(kino){
  let inhalt;
  if(kino.fehler){
    inhalt = `<p class="hinweis">Fehler beim Abrufen (${escapeHtml(kino.fehler)}).<br><a href="${escapeHtml(kino.url)}" target="_blank" rel="noopener">Programm manuell ansehen →</a></p>`;
  } else if(kino.hinweis){
    // Dritter Zustand neben Filmen und Fehler: die Quelle hat für diesen Tag prinzipbedingt
    // nichts anzubieten (z. B. keine Vorschau auf morgen).
    inhalt = `<p class="hinweis">${escapeHtml(kino.hinweis)}<br><a href="${escapeHtml(kino.url)}" target="_blank" rel="noopener">Programm manuell ansehen →</a></p>`;
  } else if(!kino.filme || kino.filme.length === 0){
    inhalt = `<p class="hinweis">Kein Programm für diesen Tag gefunden.<br><a href="${escapeHtml(kino.url)}" target="_blank" rel="noopener">Programm manuell ansehen →</a></p>`;
  } else {
    inhalt = '<ul class="filmliste">' + kino.filme.map(f => {
      const zeiten = (f.zeiten && f.zeiten.length > 0) ? f.zeiten : ['siehe Webseite'];
      const chips = zeiten.map(z => `<span class="zeit-chip">${escapeHtml(z)}</span>`).join('');
      const info = f.info ? `<span class="film-info">${escapeHtml(f.info)}</span>` : '';
      const beschreibung = f.beschreibung ? `<p class="film-beschreibung">${escapeHtml(f.beschreibung)}</p>` : '';
      const trailerUrl = f.trailerUrl ? sichereUrl(f.trailerUrl) : null;
      const trailer = trailerUrl ? `<a class="film-trailer" href="${escapeHtml(trailerUrl)}" target="_blank" rel="noopener">▶ Trailer</a>` : '';
      return `<li class="film"><div class="film-kopf"><span class="film-titel">${escapeHtml(f.titel)}</span>${info}</div>${beschreibung}<div class="film-zeiten">${chips}${trailer}</div></li>`;
    }).join('') + '</ul>';
  }
  return `<div class="group-card">
    <h3><a href="${escapeHtml(kino.url)}" target="_blank" rel="noopener">${escapeHtml(kino.name)}</a></h3>
    ${inhalt}
  </div>`;
}

// erzwingen: Server soll neu scrapen (?refresh=1). still: im Hintergrund, ohne den bereits
// sichtbaren Inhalt durch einen Ladehinweis zu ersetzen.
async function ladeKinoprogramm(erzwingen, still){
  const inhaltEl = document.getElementById('kinoInhalt');
  const standEl = document.getElementById('kinoStand');
  const refreshBtn = document.getElementById('kinoRefreshBtn');
  if(!still) refreshBtn.disabled = true;
  if(erzwingen && !still){
    inhaltEl.innerHTML = '<p class="lade-hinweis">Lade frisches Kinoprogramm…</p>';
    kinoInhaltGefuellt = false;
  }
  const angefragterTag = kinoTag;
  try{
    const url = 'api/kino?tag=' + angefragterTag + (erzwingen ? '&refresh=1' : '');
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const daten = await res.json();

    // Zwischenzeitlich umgeschaltet: die späte Antwort darf die neue Auswahl nicht überschreiben.
    if(angefragterTag !== kinoTag) return;

    setzeStand(standEl, daten.generiertAm, daten.datumLesbar + ' · ');
    inhaltEl.innerHTML = '<div class="grid">' + daten.kinos.map(renderKinoKarte).join('') + '</div>';
    kinoInhaltGefuellt = true;
    kinoGeladenUm = Date.now();
  }catch(err){
    // Nach einem Fehlschlag in einer Minute erneut versuchen statt bei jedem Tick.
    kinoGeladenUm = Date.now() - AUTO_KINO_MS + 60000;
    // Ein fehlgeschlagener Hintergrund-Abruf darf ein funktionierendes Programm nicht wegwischen.
    if(still && kinoInhaltGefuellt) return;
    inhaltEl.innerHTML = `<div class="leer-hinweis">
      Kinodaten konnten nicht geladen werden.<br>
      <span class="hinweis">(${escapeHtml(err.message)} – läuft der Homeboard-Server?)</span>
    </div>`;
    kinoInhaltGefuellt = false;
  }finally{
    if(!still) refreshBtn.disabled = false;
  }
}

function waehleKinoTag(tag){
  if(tag === kinoTag) return;
  kinoTag = tag;
  document.querySelectorAll('.tag-wahl [data-tag]').forEach(btn => {
    btn.classList.toggle('aktiv', btn.getAttribute('data-tag') === tag);
  });
  document.getElementById('kinoInhalt').innerHTML = '<p class="lade-hinweis">Lade Kinoprogramm…</p>';
  document.getElementById('kinoStand').textContent = '';
  kinoInhaltGefuellt = false;
  ladeKinoprogramm(false, false);
}

document.querySelectorAll('.tag-wahl [data-tag]').forEach(btn => {
  btn.addEventListener('click', () => waehleKinoTag(btn.getAttribute('data-tag')));
});
document.getElementById('kinoRefreshBtn').addEventListener('click', () => ladeKinoprogramm(true, false));

// ---------- Wetter ----------
const WETTERCODES = {
  0:  ['☀️','Klarer Himmel'],
  1:  ['🌤️','Überwiegend klar'],
  2:  ['⛅','Teilweise bewölkt'],
  3:  ['☁️','Bedeckt'],
  45: ['🌫️','Nebel'],
  48: ['🌫️','Reifnebel'],
  51: ['🌦️','Leichter Nieselregen'],
  53: ['🌦️','Nieselregen'],
  55: ['🌦️','Starker Nieselregen'],
  56: ['🌧️','Gefrierender Nieselregen'],
  57: ['🌧️','Starker gefrierender Nieselregen'],
  61: ['🌧️','Leichter Regen'],
  63: ['🌧️','Regen'],
  65: ['🌧️','Starker Regen'],
  66: ['🌧️','Gefrierender Regen'],
  67: ['🌧️','Starker gefrierender Regen'],
  71: ['🌨️','Leichter Schneefall'],
  73: ['🌨️','Schneefall'],
  75: ['❄️','Starker Schneefall'],
  77: ['❄️','Schneegriesel'],
  80: ['🌦️','Leichte Schauer'],
  81: ['🌧️','Schauer'],
  82: ['⛈️','Heftige Schauer'],
  85: ['🌨️','Leichte Schneeschauer'],
  86: ['❄️','Starke Schneeschauer'],
  95: ['⛈️','Gewitter'],
  96: ['⛈️','Gewitter mit Hagel'],
  99: ['⛈️','Schweres Gewitter mit Hagel'],
};
function wetterInfo(code){ return WETTERCODES[code] || ['❔','Unbekannt']; }

let wetterInhaltGefuellt = false;
let wetterGeladenUm = 0;

// Die Zeiten kommen vom Server bereits als lokale ISO-Strings für Europe/Berlin
// ("2026-08-14T15:00"). Sie werden deshalb zerlegt und nicht durch new Date() geschickt -
// sonst würde die Zeitzone des Browsers sie ein zweites Mal umrechnen.
function stundeLabel(zeit, index){
  if(index === 0) return 'Jetzt';
  const uhr = zeit.slice(11,16);
  if(uhr === '00:00') return kurzerWochentag(zeit.slice(0,10));
  return uhr;
}
function kurzerWochentag(datumISO){
  return new Date(datumISO + 'T12:00:00').toLocaleDateString('de-DE', { weekday:'short' });
}

function renderStunden(stunden){
  return stunden.map((s, i) => {
    const [icon] = wetterInfo(s.code);
    return `<div class="stunde${i === 0 ? ' jetzt' : ''}">
      <div class="zeit">${escapeHtml(stundeLabel(s.zeit, i))}</div>
      <div class="icon">${icon}</div>
      <div class="temp">${Math.round(s.temperatur)}°</div>
      <div class="regen">${s.regenrisiko != null ? s.regenrisiko + '%' : '&nbsp;'}</div>
    </div>`;
  }).join('');
}

function renderTage(tage){
  return tage.map((t, i) => {
    const [icon, beschreibung] = wetterInfo(t.code);
    const name = i === 0 ? 'Heute' : (i === 1 ? 'Morgen' : kurzerWochentag(t.datum));
    return `<div class="wetter-tag${i === 0 ? ' heute' : ''}" title="${escapeHtml(t.datumLesbar + ' · ' + beschreibung)}">
      <div class="name">${escapeHtml(name)}</div>
      <div class="icon">${icon}</div>
      <div class="temps">${Math.round(t.max)}° <span class="min">${Math.round(t.min)}°</span></div>
      <div class="regen">☔ ${t.regenrisiko != null ? t.regenrisiko + '%' : '–'}</div>
    </div>`;
  }).join('');
}

async function ladeWetter(erzwingen, still){
  const inhaltEl = document.getElementById('wetterInhalt');
  const standEl = document.getElementById('wetterStand');
  const refreshBtn = document.getElementById('wetterRefreshBtn');
  if(!still) refreshBtn.disabled = true;
  try{
    const res = await fetch('api/wetter' + (erzwingen ? '?refresh=1' : ''), { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const daten = await res.json();

    setzeStand(standEl, daten.generiertAm, '');

    const [icon, beschreibung] = wetterInfo(daten.jetzt.code);
    const heute = daten.tage[0] || {};

    inhaltEl.innerHTML = `<div class="group-card">
      <div class="wetter-jetzt">
        <span class="icon">${icon}</span>
        <div>
          <div class="temp">${Math.round(daten.jetzt.temperatur)}°C</div>
          <div class="beschreibung">${escapeHtml(beschreibung)} · gefühlt ${Math.round(daten.jetzt.gefuehlt)}°C</div>
        </div>
      </div>
      <div class="wetter-stats">
        <span class="stat-pill">🔻 <span class="num">${Math.round(heute.min)}°</span> Min</span>
        <span class="stat-pill">🔺 <span class="num">${Math.round(heute.max)}°</span> Max</span>
        <span class="stat-pill">💧 <span class="num">${daten.jetzt.luftfeuchte}%</span> Luftfeuchte</span>
        <span class="stat-pill">🌬️ <span class="num">${Math.round(daten.jetzt.wind)}</span> km/h Wind</span>
        <span class="stat-pill">☔ <span class="num">${heute.regenrisiko}%</span> Regenrisiko</span>
      </div>
      <p class="abschnitt-titel">Nächste ${daten.stunden.length} Stunden</p>
      <div class="stunden-leiste">${renderStunden(daten.stunden)}</div>
      <p class="abschnitt-titel">${daten.tage.length}-Tage-Vorhersage</p>
      <div class="tage-leiste">${renderTage(daten.tage)}</div>
    </div>`;
    wetterInhaltGefuellt = true;
    wetterGeladenUm = Date.now();
  }catch(err){
    wetterGeladenUm = Date.now() - AUTO_WETTER_MS + 60000;
    if(still && wetterInhaltGefuellt) return;
    inhaltEl.innerHTML = `<div class="leer-hinweis">
      Wetterdaten konnten nicht geladen werden.<br>
      <span class="hinweis">(${escapeHtml(err.message)} – hat der Homeboard-Server Internetzugriff?)</span>
    </div>`;
    wetterInhaltGefuellt = false;
  }finally{
    if(!still) refreshBtn.disabled = false;
  }
}
document.getElementById('wetterRefreshBtn').addEventListener('click', () => ladeWetter(true, false));

// ---------- Neue Alben ----------
let albenInhaltGefuellt = false;
let albenGeladenUm = 0;

function initialen(interpret){
  return String(interpret).split(/\s+/).filter(Boolean).slice(0,2)
    .map(wort => wort[0].toUpperCase()).join('');
}

function coverPlatzhalter(kuerzel){
  return `<div class="cover-leer"><span class="note">🎵</span><span class="initialen">${escapeHtml(kuerzel)}</span></div>`;
}

function renderAlbum(album){
  const kuerzel = initialen(album.interpret);
  const coverUrl = album.coverUrl ? sichereUrl(album.coverUrl) : null;
  // data-initialen wird gebraucht, falls das Bild erst beim Laden scheitert (siehe unten).
  const bild = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initialen="${escapeHtml(kuerzel)}">`
    : coverPlatzhalter(kuerzel);
  const zusatz = album.info ? `<span class="zusatz">${escapeHtml(album.info)}</span>` : '';
  const inhalt = `<div class="cover">${bild}</div>
    <span class="interpret">${escapeHtml(album.interpret)}</span>
    <span class="albumtitel">${escapeHtml(album.titel)}</span>${zusatz}`;

  const url = album.url ? sichereUrl(album.url) : null;
  return url
    ? `<a class="album" href="${escapeHtml(url)}" target="_blank" rel="noopener">${inhalt}</a>`
    : `<div class="album">${inhalt}</div>`;
}

async function ladeAlben(erzwingen, still){
  const inhaltEl = document.getElementById('albenInhalt');
  const standEl = document.getElementById('albenStand');
  const refreshBtn = document.getElementById('albenRefreshBtn');
  if(!still) refreshBtn.disabled = true;
  if(erzwingen && !still){
    inhaltEl.innerHTML = '<p class="lade-hinweis">Suche neue Alben…</p>';
    albenInhaltGefuellt = false;
  }
  try{
    const res = await fetch('api/alben' + (erzwingen ? '?refresh=1' : ''), { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const daten = await res.json();

    setzeStand(standEl, daten.generiertAm, '');

    // Der Server liefert bei einer Störung den letzten brauchbaren Stand mitsamt Fehlertext.
    const stoerung = daten.fehler
      ? `<div class="alben-stoerung">Die Quelle war zuletzt nicht erreichbar
          (${escapeHtml(daten.fehler)}). Angezeigt wird der letzte gespeicherte Stand.</div>`
      : '';

    const quelle = sichereUrl(daten.quelle || '');
    const quellLink = quelle
      ? `<a class="quelle" href="${escapeHtml(quelle)}" target="_blank" rel="noopener">tonspion.de ↗</a>`
      : '';

    inhaltEl.innerHTML = stoerung + `<div class="alben-datum">
        <span class="label">Neuerscheinungen vom</span>
        <span class="datum">${escapeHtml(daten.datumLesbar)}</span>
        <span class="anzahl">· ${daten.alben.length} ${daten.alben.length === 1 ? 'Album' : 'Alben'}</span>
        ${quellLink}
      </div>
      <div class="alben-grid">${daten.alben.map(renderAlbum).join('')}</div>`;

    // Ein Cover, das erst beim Laden scheitert (gelöscht, Netz weg), soll kein kaputtes Bild
    // hinterlassen - dann greift derselbe Platzhalter wie bei einem gar nicht gefundenen Cover.
    inhaltEl.querySelectorAll('.album .cover img').forEach(img => {
      img.addEventListener('error', () => {
        const cover = img.closest('.cover');
        if(cover) cover.innerHTML = coverPlatzhalter(img.dataset.initialen || '');
      });
    });

    albenInhaltGefuellt = true;
    albenGeladenUm = Date.now();
  }catch(err){
    albenGeladenUm = Date.now() - AUTO_ALBEN_MS + 60000;
    if(still && albenInhaltGefuellt) return;
    inhaltEl.innerHTML = `<div class="leer-hinweis">
      Neuerscheinungen konnten nicht geladen werden.<br>
      <span class="hinweis">(${escapeHtml(err.message)} – hat der Homeboard-Server Internetzugriff?)</span>
    </div>`;
    albenInhaltGefuellt = false;
  }finally{
    if(!still) refreshBtn.disabled = false;
  }
}
document.getElementById('albenRefreshBtn').addEventListener('click', () => ladeAlben(true, false));

// ---------- Automatische Aktualisierung (Wandtablet-Dauerbetrieb) ----------
// Die Seite wird auf dem Tablet tage- bis wochenlang nicht neu geladen. Ein Intervall prüft
// daher regelmäßig, ob die sichtbare Ansicht veraltet ist, und lädt still nach. Erzwungen
// (?refresh=1) wird dabei nie - über die Frische der Daten entscheidet der Server-Cache.
const AUTO_KINO_MS = 15 * 60 * 1000;
const AUTO_WETTER_MS = 10 * 60 * 1000;
// Die Albenliste wechselt einmal pro Woche - häufiger als stündlich nachzufragen wäre sinnlos.
const AUTO_ALBEN_MS = 60 * 60 * 1000;
const TICK_MS = 30 * 1000;

function pruefeAktualitaet(){
  const tageswechsel = aktualisiereKopfDatum();
  aktualisiereAlleStaende();

  if(tageswechsel){
    // Nach Mitternacht meint "heute" einen anderen Tag - alles Angezeigte ist damit veraltet.
    kinoGeladenUm = 0;
    wetterGeladenUm = 0;
    if(kinoTag !== 'heute'){
      kinoTag = 'heute';
      document.querySelectorAll('.tag-wahl [data-tag]').forEach(btn => {
        btn.classList.toggle('aktiv', btn.getAttribute('data-tag') === 'heute');
      });
    }
  }

  if(document.hidden) return;
  if(aktuelleView === 'kino' && Date.now() - kinoGeladenUm > AUTO_KINO_MS){
    ladeKinoprogramm(false, true);
  }
  if(aktuelleView === 'wetter' && wetterGeladen && Date.now() - wetterGeladenUm > AUTO_WETTER_MS){
    ladeWetter(false, true);
  }
  if(aktuelleView === 'alben' && albenGeladen && Date.now() - albenGeladenUm > AUTO_ALBEN_MS){
    ladeAlben(false, true);
  }
}

setInterval(pruefeAktualitaet, TICK_MS);

// Beim Zurückkehren zum Tablet nicht bis zum nächsten Tick warten.
document.addEventListener('visibilitychange', () => {
  if(!document.hidden) pruefeAktualitaet();
});
