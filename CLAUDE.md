# CLAUDE.md

Kontext für Claude Code bei der Arbeit an diesem Repository.

## Was ist das Projekt?

**Homeboard** — ein privates Dashboard für den Heimgebrauch (Familien-/Wandtablet, LAN-only).
Zwei Kacheln: **Kinoprogramm Magdeburg** (vier Kinos, live gescraped) und **Wetter Magdeburg**
(Open-Meteo). Läuft als kleiner Node-Server im LAN, typischerweise als Docker-Container auf
einem Unraid-Server.

Sprache im Code und in der Dokumentation ist **Deutsch** — Variablen, Funktionen und Kommentare
(`erstelleKinoprogramm`, `holeKinoDaten`, `heuteISO`, `filme`, `zeiten`, `fehler`). Diese
Konvention beibehalten.

## Tech-Stack

| Bereich | Wahl |
|---|---|
| Runtime | Node.js (getestet mit v22.22.2) |
| Server | `node:http` — **kein** Express, kein Framework |
| Frontend | Eine einzige `index.html`, Vanilla JS + CSS inline, **kein** Build-Schritt |
| Einzige Dependency | `playwright` ^1.61.1 (nur für das Moritzhof-Scraping) |
| HTTP-Client | Globales `fetch()` (Node 18+), keine Extra-Bibliothek |
| Deployment | Docker Compose auf Unraid, Image `mcr.microsoft.com/playwright:v1.61.1-noble` |

Bewusst dependency-arm: HTML wird per Regex geparst statt mit Cheerio, drei der vier Kinos
laufen über `fetch()` statt Browser. Diesen Ansatz nicht ohne Anlass durch Bibliotheken ersetzen.

## Ordnerstruktur

```
server.js            HTTP-Server, Cache-Logik, statisches Ausliefern
lib/kino.js          Vier Kino-Scraper + erstelleKinoprogramm()
index.html           Komplettes Frontend (Markup, CSS, JS in einer Datei)
data/kino.json       Persistenter Cache (wird zur Laufzeit geschrieben)
docker-compose.yml   Unraid-Stack
ANLEITUNG-UNRAID.md  Deployment-Anleitung
Homeboard-starten.bat Windows-Starter
```

## Befehle

```bash
npm install          # Dependencies (nur playwright)
npm start            # Server auf Port 3000 (PORT=... überschreibt)
node --check server.js && node --check lib/kino.js   # Syntaxprüfung
```

Ein Test-Framework gibt es **nicht** — kein `test`-Script, keine Testdateien, keine CI.

## Wichtige Besonderheiten

- **`PORT`** setzt den Port, **`HOMEBOARD_DOCKER=1`** schaltet Chromium auf
  `--no-sandbox --disable-dev-shm-usage` (im Container nötig, lokal unerwünscht).
- **Cache:** 45 Minuten TTL im RAM, zusätzlich als `data/kino.json` auf Platte. Beim Start wird
  eine Datei von *heute* als warmer Cache übernommen. `?refresh=1` erzwingt Neuladen.
  `laufenderScrape` verhindert parallele Mehrfach-Scrapes.
- **Datum** wird konsequent über `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'` gebildet,
  nicht über die Systemzeit. Bei Änderungen beibehalten — der Server läuft evtl. in UTC.
- **Scraping ist per Definition fragil.** Ändert ein Kino sein Markup, bricht genau dieser
  Scraper. Der Fehler wird pro Kino im Feld `fehler` transportiert, die anderen drei liefern
  weiter. Diese Isolation nicht aufgeben.
- **Kein Build.** Frontend-Änderungen gehen direkt in `index.html`. Deployment heißt: Dateien
  kopieren, Container neu starten.

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
      "fehler": null        // oder Fehlertext, dann filme: []
    }
  ]
}
```

Interne Felder (`_movieId`, `_detailUrl`, `_href`) werden vor der Rückgabe gelöscht — beim
Erweitern der Scraper genauso handhaben.

## Definition of Done

Vor jedem Commit:

1. `node --check server.js && node --check lib/kino.js` — Syntax sauber.
2. `npm start` und `curl localhost:3000/` — HTTP 200, Frontend lädt.
3. `curl "localhost:3000/api/kino"` — gültiges JSON; pro Kino entweder `filme` gefüllt **oder**
   ein aussagekräftiges `fehler`-Feld. Ein fehlgeschlagenes Kino darf die anderen nicht mitreißen.
4. Bei Frontend-Änderungen: Seite im Browser öffnen, beide Views (Kino, Wetter) sowie Hell-/
   Dunkelmodus durchklicken.
5. Bei Scraper-Änderungen: `?refresh=1` verwenden, sonst testest du gegen den 45-Minuten-Cache.

Ohne Netzugriff auf die Kinoseiten schlagen die Scraper mit `HTTP 403` o. ä. fehl — das ist dann
eine Umgebungs-, keine Codefrage. Für das Moritzhof-Scraping muss zusätzlich ein Chromium für
Playwright installiert sein.

## Schutzmechanismen, die nicht aufgeweicht werden dürfen

Die Analyse in `ANALYSIS.md` hat elf Befunde ergeben, alle behoben. Diese Vorkehrungen bitte bei
Änderungen erhalten:

- **Scraper müssen laut scheitern.** Fehlt ein erwarteter HTML-Anker, wird geworfen
  (`lib/kino.js`: `Programm Heute` bei Studiokino, `.program_item` bei Moritzhof). Niemals eine
  leere Filmliste mit `fehler: null` zurückgeben — sonst ist ein defekter Scraper nicht von einem
  spielfreien Tag zu unterscheiden.
- **Jede Fremdanfrage braucht ein Zeitlimit.** `holeMitTimeout()` statt nacktem `fetch()`
  (`FETCH_TIMEOUT_MS`), zusätzlich `mitZeitlimit()` pro Kino (`KINO_TIMEOUT_MS`).
- **Die vier Kinos laufen parallel** (`Promise.all` in `erstelleKinoprogramm`) — bei
  Erweiterungen die Fehlerisolation pro Kino beibehalten.
- **`OEFFENTLICHE_DATEIEN` in `server.js` ist eine Allowlist.** Neue Assets dort eintragen. Nicht
  auf „alles im Ordner ausliefern" zurückbauen — sonst sind Quellcode und `.git` wieder abrufbar.
- **Ein Ergebnis ohne einen einzigen Film wird nicht persistiert** und nur kurz gecacht
  (`FEHLER_TTL_MS`), damit eine Störung nicht 45 Minuten nachwirkt.
- **Fremd-URLs laufen durch `sichereUrl()`** (in `lib/kino.js` und `index.html`) — nur `http`/
  `https`, damit kein `javascript:` in ein `href` gelangt.

## Backup / Rollback

Vor größeren Umbauten einen Tag setzen: `git tag pre-<vorhaben>`. Der laufende Stand auf Unraid
liegt in `/mnt/user/appdata/homeboard` — bei Problemen genügt es, die vorherigen Dateien
zurückzukopieren und den Stack neu zu starten (kein Rebuild nötig).
