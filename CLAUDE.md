# CLAUDE.md

Kontext für Claude Code bei der Arbeit an diesem Repository.

## Was ist das Projekt?

**Homeboard** — ein privates Dashboard für den Heimgebrauch (Familien-/Wandtablet, LAN-only).
Drei Kacheln: **Kinoprogramm Magdeburg** (vier Kinos, live gescraped, heute und morgen),
**Wetter Magdeburg** (Open-Meteo, aktuell + 24 Stunden + 5 Tage) und **Neue Alben**
(Musik-Neuerscheinungen der Woche von tonspion.de, Cover über die iTunes-Suche). Läuft als kleiner Node-Server
im LAN, typischerweise als Docker-Container auf einem Unraid-Server.

Sprache im Code und in der Dokumentation ist **Deutsch** — Variablen, Funktionen und Kommentare
(`erstelleKinoprogramm`, `holeKinoDaten`, `heuteISO`, `filme`, `zeiten`, `fehler`). Diese
Konvention beibehalten, auch in den JSON-Feldern der eigenen API.

## Tech-Stack

| Bereich | Wahl |
|---|---|
| Runtime | Node.js (getestet mit v22.22.2) |
| Server | `node:http` — **kein** Express, kein Framework |
| Frontend | `index.html` + `app.css` + `app.js`, Vanilla JS, **kein** Build-Schritt |
| Tests | `node --test` (Bordmittel), keine Test-Bibliothek |
| Einzige Dependency | `playwright` ^1.61.1 (nur für das Moritzhof-Scraping) |
| HTTP-Client | Globales `fetch()` (Node 18+), keine Extra-Bibliothek |
| Deployment | Docker Compose auf Unraid, Image `mcr.microsoft.com/playwright:v1.61.1-noble` |

Bewusst dependency-arm: HTML wird per Regex geparst statt mit Cheerio, drei der vier Kinos
laufen über `fetch()` statt Browser. Diesen Ansatz nicht ohne Anlass durch Bibliotheken ersetzen.

## Ordnerstruktur

```
server.js            HTTP-Server, Cache-Logik, statisches Ausliefern
lib/kino.js          Vier Kino-Scraper + erstelleKinoprogramm()
lib/wetter.js        Open-Meteo-Abruf + Normalisierung auf das eigene Datenmodell
lib/musik.js         tonspion-Scraper + Cover-Suche → erstelleAlbenliste()
lib/http.js          holeMitTimeout() / mitZeitlimit() — für alle Fremdanfragen
lib/datum.js         Kalendertage in Europe/Berlin (heuteISO, morgenISO, lesbaresDatum)
lib/text.js          HTML-Werkzeuge für beide Scraper (sichereUrl, stripHtmlTags, Entities)
index.html           Markup
app.css              Komplettes Stylesheet inkl. Hell-/Dunkelmodus
app.js               Komplette Frontend-Logik
test/*.test.js       Smoke-Tests, laufen ohne Netzzugriff
data/kino-<datum>.json  Persistenter Kino-Cache (wird zur Laufzeit geschrieben)
data/alben.json      Persistenter Alben-Cache (wird zur Laufzeit geschrieben)
docker-compose.yml   Unraid-Stack
ANLEITUNG-UNRAID.md  Deployment-Anleitung
Homeboard-starten.bat Windows-Starter
```

## Befehle

```bash
npm install          # Dependencies (nur playwright)
npm start            # Server auf Port 3000 (PORT=... überschreibt)
npm test             # Smoke-Tests, kein Netzzugriff nötig
node --check server.js && node --check lib/kino.js   # Syntaxprüfung
```

## Wichtige Besonderheiten

- **`PORT`** setzt den Port (`PORT=0` wählt einen freien — so starten die Tests),
  **`HOMEBOARD_DOCKER=1`** schaltet Chromium auf `--no-sandbox --disable-dev-shm-usage`
  (im Container nötig, lokal unerwünscht).
- **Kino-Cache:** 45 Minuten TTL im RAM **pro Datum**, zusätzlich als `data/kino-<datum>.json`
  auf Platte. Beim Start werden die Dateien für heute und morgen als warmer Cache übernommen,
  alle anderen gelöscht. `?refresh=1` erzwingt Neuladen. `laufendeScrapes` (Map pro Datum)
  verhindert parallele Mehrfach-Scrapes.
- **Wetter-Cache:** 15 Minuten, nur im RAM — eine Vorhersage von gestern ist wertlos, ein warmer
  Start bringt hier nichts.
- **Alben-Cache:** 3 Stunden im RAM, zusätzlich als `data/alben.json`. Die Liste wechselt nur
  einmal pro Woche, ihr Aufbau kostet aber einen Seitenabruf plus eine Cover-Suche je Album —
  deshalb hier der lange TTL und der warme Start.
- **Die tonspion-Seite ist eine Monatsübersicht.** Unter einer Monatsüberschrift stehen mehrere
  Datumszeilen im Format `TT.MM.JJ` (`14.08.26`), darunter jeweils die Alben dieses Freitags —
  auch schon die kommender Wochen. `lib/musik.js` zerlegt die Seite deshalb in Datumsabschnitte
  und nimmt den **jüngsten bereits erschienenen**. Alle Zeilen der Seite einzusammeln wäre falsch,
  das ergäbe eine Mischung aus mehreren Wochen.
- **Das Alben-Datum wird gelesen, nicht gerechnet.** Verbindlich ist die Datumszeile der Quelle.
  Steht dort noch der letzte Freitag, zeigt das Homeboard auch den letzten Freitag — lieber ein
  sichtbar alter Stand als alte Alben, die als neu ausgegeben werden.
- **Nicht jede Albumzeile hat einen Trenner.** Bei manchen Einträgen fehlt auf der Quelle der
  Gedankenstrich (`Dent May The Big One`). Solche Zeilen bleiben ungeteilt: `interpret` trägt den
  ganzen Text, `titel` ist `null`. Ein geratener Schnitt wäre schlechter als ein ungetrennter
  Eintrag, und wegwerfen wäre schlechter als beides.
- **Datum** wird konsequent über `lib/datum.js` (`Intl.DateTimeFormat`, `timeZone: 'Europe/Berlin'`)
  gebildet, nicht über die Systemzeit. Bei Änderungen beibehalten — der Server läuft evtl. in UTC.
- **Scraping ist per Definition fragil.** Ändert ein Kino sein Markup, bricht genau dieser
  Scraper. Der Fehler wird pro Kino im Feld `fehler` transportiert, die anderen drei liefern
  weiter. Diese Isolation nicht aufgeben.
- **Kein Build.** Frontend-Änderungen gehen direkt in `index.html`/`app.css`/`app.js`.
  Deployment heißt: Dateien kopieren, Container neu starten.

## API

| Route | Parameter | Antwort |
|---|---|---|
| `GET /api/kino` | `tag=heute\|morgen` (Standard `heute`), `refresh=1` | Kinoprogramm, 400 bei unbekanntem Tag |
| `GET /api/wetter` | `refresh=1` | Vorhersage, 502 nur wenn noch nie etwas geladen wurde |
| `GET /api/alben` | `refresh=1` | Neuerscheinungen, 502 nur wenn noch nie etwas geladen wurde |

`tag` ist absichtlich kein freier Datumsparameter: jeder Wert würde sonst einen Scrape gegen vier
Fremdseiten auslösen.

## Datenmodell

`/api/kino` liefert:

```jsonc
{
  "datum": "2026-08-14",
  "datumLesbar": "Freitag, 14.08.2026",
  "generiertAm": "2026-08-14T14:42:59.089Z",
  "kinos": [
    {
      "id": "cinestar",
      "name": "CineStar Magdeburg",
      "url": "https://…",
      "filme": [
        { "titel": "…", "info": "…", "zeiten": ["14:30"], "beschreibung": "…", "trailerUrl": "…" }
      ],
      "hinweis": null,      // Quelle in Ordnung, hat für diesen Tag aber prinzipbedingt nichts
      "fehler": null        // oder Fehlertext, dann filme: []
    }
  ]
}
```

Ein Kino trägt genau einen von drei Zuständen: **Filme**, **Hinweis** (z. B. Studiokino hat keine
Vorschau auf morgen) oder **Fehler**. Interne Felder (`_movieId`, `_detailUrl`, `_href`) werden vor
der Rückgabe gelöscht — beim Erweitern der Scraper genauso handhaben.

`/api/wetter` liefert:

```jsonc
{
  "ort": "Magdeburg",
  "generiertAm": "2026-08-14T15:20:11.004Z",
  "jetzt":   { "zeit": "2026-08-14T15:20", "temperatur": 21.4, "gefuehlt": 20.1,
               "code": 3, "wind": 12.6, "luftfeuchte": 61 },
  "stunden": [ { "zeit": "2026-08-14T15:00", "temperatur": 21.8, "code": 3, "regenrisiko": 10 } ],
  "tage":    [ { "datum": "2026-08-14", "datumLesbar": "Freitag, 14.08.2026",
                 "min": 13.8, "max": 24.2, "code": 3, "regenrisiko": 20 } ]
}
```

Zeiten in `stunden`/`tage` sind **lokale** ISO-Strings für Europe/Berlin (ohne Zeitzonensuffix).
Im Frontend werden sie zerlegt und nicht durch `new Date()` geschickt — sonst rechnet der Browser
sie ein zweites Mal um.

`/api/alben` liefert:

```jsonc
{
  "datum": "2026-08-14",                      // aus der Überschrift der Quelle gelesen
  "datumLesbar": "Freitag, 14.08.2026",
  "quelle": "https://www.tonspion.de/news/musik-neuerscheinungen-neue-alben",
  "generiertAm": "2026-08-14T06:12:44.301Z",
  "alben": [
    { "interpret": "Beth Gibbons", "titel": "Lives Outgrown",
      "info": "Domino",           // kurzer Klammerzusatz der Quelle (Label/Genre), sonst null
                                  // titel ist null, wenn die Zeile keinen Trenner hatte
      "url": "https://…",         // Link der Quelle, sonst null
      "spotifyUrl": "https://open.spotify.com/search/…",  // Suchlink, immer gesetzt
      "coverUrl": "https://…" }   // iTunes-Cover, sonst null → Frontend zeigt Platzhalter
  ],
  "fehler": null                  // nur gesetzt, wenn ein alter Stand ausgeliefert wird
}
```

Die Albumkachel führt zu `spotifyUrl`. Das ist bewusst ein **Suchlink** und kein echter
Albumlink: der bräuchte die Spotify-API mitsamt Zugangsdaten und Token-Erneuerung. Der Suchlink
kostet keine Anfrage, kann deshalb nie fehlschlagen und ist immer gesetzt.

Ein Album ohne Cover bleibt ein vollwertiger Eintrag — `coverUrl: null` ist ein Normalfall, kein
Fehler. Das Feld `fehler` taucht nur auf, wenn der Abruf scheiterte und deshalb der letzte
gespeicherte Stand zurückgegeben wird; das Frontend blendet dann einen Hinweis über die Liste.

## Definition of Done

Vor jedem Commit:

1. `node --check server.js && node --check lib/kino.js && node --check lib/musik.js` — Syntax sauber.
2. `npm test` — alle Smoke-Tests grün (läuft ohne Netzzugriff).
3. `npm start` und `curl localhost:3000/` — HTTP 200, Frontend lädt.
4. `curl "localhost:3000/api/kino"` — gültiges JSON; pro Kino entweder `filme` gefüllt **oder**
   ein `hinweis` **oder** ein aussagekräftiges `fehler`-Feld. Ein fehlgeschlagenes Kino darf die
   anderen nicht mitreißen.
5. `curl "localhost:3000/api/alben"` — `datum` passt zum Datum auf der tonspion-Seite, `alben`
   ist nicht leer. Eine leere Liste ist ein Fehler, kein Ergebnis (siehe unten).
6. Bei Frontend-Änderungen: Seite im Browser öffnen, alle drei Views (Kino inkl. Umschalter
   heute/morgen, Wetter, Neue Alben) sowie Hell-/Dunkelmodus durchklicken.
7. Bei Scraper-Änderungen: `?refresh=1` verwenden, sonst testest du gegen den Cache.

Ohne Netzugriff auf die Kino-, Wetter- und tonspion-Seiten schlagen die Abrufe mit `HTTP 403`
o. ä. fehl — das ist dann eine Umgebungs-, keine Codefrage; `npm test` läuft davon unabhängig.
Für das Moritzhof-Scraping muss zusätzlich ein Chromium für Playwright installiert sein.

## Schutzmechanismen, die nicht aufgeweicht werden dürfen

Die Analyse in `ANALYSIS.md` hat elf Befunde ergeben, alle behoben. Diese Vorkehrungen bitte bei
Änderungen erhalten:

- **Scraper müssen laut scheitern.** Fehlt ein erwarteter HTML-Anker, wird geworfen
  (`lib/kino.js`: `Programm Heute` bei Studiokino, `.program_item` bei Moritzhof;
  `lib/musik.js`: kein Datumsabschnitt bzw. keine erkennbare Albumzeile darin). Niemals eine
  leere Filmliste mit `fehler: null` **und** `hinweis: null` zurückgeben — sonst ist ein defekter
  Scraper nicht von einem spielfreien Tag zu unterscheiden. Dasselbe gilt für eine leere
  Albenliste: sie sähe aus wie „diese Woche erscheint nichts" und ist deshalb ein Fehler.
- **Jede Fremdanfrage braucht ein Zeitlimit.** `holeMitTimeout()` aus `lib/http.js` statt nacktem
  `fetch()`, zusätzlich `mitZeitlimit()` pro Kino (`KINO_TIMEOUT_MS`).
- **Die vier Kinos laufen parallel** (`Promise.all` in `erstelleKinoprogramm`) — bei
  Erweiterungen die Fehlerisolation pro Kino beibehalten.
- **`OEFFENTLICHE_DATEIEN` in `server.js` ist eine Allowlist.** Neue Assets dort eintragen. Nicht
  auf „alles im Ordner ausliefern" zurückbauen — sonst sind Quellcode und `.git` wieder abrufbar.
- **Ein Ergebnis ohne einen einzigen Film wird nicht persistiert** und nur kurz gecacht
  (`FEHLER_TTL_MS`), damit eine Störung nicht 45 Minuten nachwirkt.
- **Fremd-URLs laufen durch `sichereUrl()`** (aus `lib/text.js`, im Frontend nochmals in
  `app.js`) — nur `http`/`https`, damit kein `javascript:` in ein `href` oder `src` gelangt.
  Das betrifft auch Cover-Adressen und die Albumlinks von tonspion.
- **`tag` bleibt eine Allowlist** (`heute`/`morgen`), kein freier Datumsparameter.
- **Ein gescheiterter Wetter- oder Albenabruf leert die Kachel nicht**, sondern liefert den
  letzten brauchbaren Stand weiter; das Frontend zeigt über das Alter, wie frisch er ist, und
  bei den Alben zusätzlich über das Feld `fehler`, warum er es nicht ist.
- **Der Spotify-Link bleibt ein Suchlink.** Er wird ohne Fremdanfrage gebildet und ist damit die
  einzige Angabe am Album, die nicht ausfallen kann. Wer ihn auf echte Albumlinks umstellt, holt
  sich Zugangsdaten, Token-Erneuerung und eine weitere Fehlerquelle ins Haus — dann bitte mit
  Rückfall auf den Suchlink.
- **Ein fehlendes Cover kostet nie den Albumeintrag.** Jede Cover-Suche ist einzeln abgesichert;
  schlägt sie fehl, bleibt `coverUrl: null` und das Frontend zeigt einen Platzhalter in gleicher
  Größe, damit das Raster nicht springt.
- **Ein fehlgeschlagener Hintergrund-Refresh im Frontend überschreibt keinen funktionierenden
  Inhalt** (`still`-Parameter in `ladeKinoprogramm`/`ladeWetter`/`ladeAlben`).

## Backup / Rollback

Vor größeren Umbauten einen Tag setzen: `git tag pre-<vorhaben>`. Der laufende Stand auf Unraid
liegt in `/mnt/user/appdata/homeboard` — bei Problemen genügt es, die vorherigen Dateien
zurückzukopieren und den Stack neu zu starten (kein Rebuild nötig).
