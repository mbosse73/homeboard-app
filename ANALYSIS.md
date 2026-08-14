# Analyse Homeboard

Ergebnis des Onboarding-Durchlaufs vom 14.08.2026 (Phasen 2–4 aus `START_HERE.md`).
Stand des untersuchten Codes: Commit `4d88287`.

> **Status:** Alle elf Befunde aus Abschnitt 2 sind behoben. Die Befundtexte bleiben als
> Dokumentation des ursprünglichen Zustands stehen; jeder trägt einen Hinweis auf die Umsetzung.
> Damit umgesetzt sind zugleich die Vorschläge A1–A9 aus Abschnitt 3.

---

## 1. Überblick

**Homeboard** ist ein privates LAN-Dashboard mit zwei Funktionen: Kinoprogramm Magdeburg
(vier Kinos) und Wetter Magdeburg. Es läuft als Node-Server, üblicherweise als Docker-Container
auf einem Unraid-Server.

### Architektur

Drei Schichten mit genau einer Kopplung zwischen Server und Datenbeschaffung
(`erstelleKinoprogramm()`):

```
index.html    Präsentation — View-Umschaltung ohne Router, CSS+JS inline
   ↓ fetch
server.js     HTTP, Cache-Logik, statische Auslieferung
   ↓ require
lib/kino.js   Vier Kino-Scraper
```

### Einstiegspunkte

| Datei | Zeile | Funktion |
|---|---|---|
| `server.js` | 98 | `server.listen()` |
| `lib/kino.js` | 307 | `erstelleKinoprogramm()` |
| `index.html` | 443 | Frontend-Bootstrap |

### Tech-Stack

- Node.js (getestet v22.22.2), Server auf `node:http` — kein Framework
- Frontend: eine `index.html`, Vanilla JS, **kein Build-Schritt**
- Einzige Laufzeit-Dependency: `playwright@1.61.1` (→ `playwright-core@1.61.1`)
- HTTP-Client: globales `fetch()`
- Deployment: Docker Compose, Image `mcr.microsoft.com/playwright:v1.61.1-noble`

Das Projekt ist bewusst dependency-arm: HTML wird per Regex geparst statt mit einer
Parser-Bibliothek, drei der vier Kinos laufen ohne Browser.

### Datenfluss

Zwei unabhängige Pfade — fällt einer aus, funktioniert der andere weiter:

- **Kino:** Browser → `/api/kino` → RAM-Cache (45 min TTL) → bei Miss vier Scraper → `data/kino.json`
- **Wetter:** Browser → **direkt** zu `api.open-meteo.com`, ohne Server-Beteiligung

### Externe Abhängigkeiten

| Quelle | Art | Anmerkung |
|---|---|---|
| CineStar | JSON-API | inoffiziell, feste Kino-ID `37` |
| CinemaxX | JSON-API | inoffiziell, feste Kino-ID `1391` |
| Studiokino | HTML + Regex | bricht bei Markup-Änderung |
| Moritzhof | Playwright + HTML | Infinite-Scroll, braucht Chromium |
| Open-Meteo | JSON-API | offiziell, kein Key nötig |

**Vier der fünf Quellen sind inoffiziell** und können sich jederzeit ändern. Nur wegen Moritzhof
wird überhaupt Playwright und damit das 1,5-GB-Image benötigt.

### Build & Deployment

Kein Build. Deployment heißt: Dateien nach `/mnt/user/appdata/homeboard` kopieren, Stack neu
starten. `npm ci` läuft bei jedem Containerstart.

---

## 2. Befunde

Verifiziert am laufenden Server (Port 3999) sowie durch isolierte Reproduktion der Parser-Logik.
`npm audit`: **0 Schwachstellen**. **Keine hartcodierten Secrets** — die App benötigt keinerlei
Credentials.

### Kritisch

Keine. Für eine LAN-only-App ohne Authentifizierung und ohne Nutzerdaten rechtfertigt kein Befund
diese Stufe.

### Mittel

**M1 — Stiller Fehlschlag im Studiokino-Scraper** (`lib/kino.js:143`)
Fehlt `"Programm Heute"` im HTML, liefert `indexOf` `-1`; `slice(-1, …)` ergibt `">"`, kein Artikel
matcht → **leere Filmliste mit `fehler: null`**. Ein defekter Scraper ist damit nicht von einem
spielfreien Tag unterscheidbar. Gleiches Muster in `lib/kino.js:177` (Moritzhof-Detailseite).
*Reproduziert:* HTML ohne die Überschrift ergibt `abschnitt.length = 1`, `0` Filme, kein Fehler.
**Behoben:** Studiokino wirft bei fehlendem Anker, Moritzhof bei `events.length === 0`; die
Moritzhof-Detailseite nutzt `Math.max(indexOf, 0)` statt `slice(-1, …)`.

**M2 — Kein Timeout auf `fetch()`** (Zeilen 53, 81, 104, 139, 174, 274)
Kein `AbortSignal` in sieben Aufrufen. Eine hängende Kino-API blockiert `/api/kino` unbegrenzt.
Verschärft durch die **sequenzielle** Schleife (`lib/kino.js:318`) — die vier Kinos addieren sich.
**Behoben:** `holeMitTimeout()` reicht `AbortSignal.timeout(10s)` an jeden Aufruf durch,
`mitZeitlimit()` begrenzt jedes Kino auf 90s, und `Promise.all` ersetzt die Schleife.
*Nachgewiesen:* mit einem 2s-Stub pro Anfrage sinkt die Gesamtdauer von erwarteten >6s auf 2,02s.

**M3 — Beliebige Dateiauslieferung** (`server.js:86`)
`/.git/config`, `/server.js`, `/lib/kino.js`, `/package.json`, `/node_modules/…` liefern alle
`HTTP 200`. Die Unraid-Anleitung schließt `.git` beim Kopieren nicht aus.
*Kein* Directory-Traversal-Ausbruch: der WHATWG-URL-Parser normalisiert `..` weg, `/etc/passwd`
gibt korrekt 404. Es geht ausschließlich um Dateien innerhalb des App-Ordners.
**Behoben:** `OEFFENTLICHE_DATEIEN` ist eine Allowlist; alles außer `/` und `/index.html`
antwortet mit 404. *Nachgewiesen* für `.git/config`, `server.js`, `lib/kino.js`, `package.json`,
`.gitignore`, `data/kino.json` und `node_modules/…`.

**M4 — Cache-Vergiftung bei Totalausfall** (`server.js:47-53`)
Schlagen alle vier Kinos fehl, wird dieses Ergebnis in den RAM-Cache **und** nach
`data/kino.json` geschrieben. Ein 30-Sekunden-Netzausfall bedeutet 45 Minuten „kein Programm".
**Behoben:** Ohne einen einzigen Film wird nicht auf Platte geschrieben und nur `FEHLER_TTL_MS`
(3 min) gecacht; beim Start wird eine filmlose Datei nicht mehr als warmer Cache übernommen.
*Nachgewiesen:* Cache-Datei blieb nach einem Totalausfall unverändert.

### Gering

**G1 — `javascript:`-URLs im Trailer-Link** (`index.html:513`)
`escapeHtml` filtert `& < > "`, aber kein URL-Schema. `f.trailerUrl` stammt bei Moritzhof aus dem
Fremdattribut `data-trailer-link` (`lib/kino.js:277`). Ausnutzung setzt Kompromittierung der
Fremdseite voraus.
**Behoben:** `sichereUrl()` lässt nur `http:`/`https:` durch — serverseitig beim Übernehmen des
Attributs und nochmals im Frontend vor der Ausgabe. *Nachgewiesen* gegen `javascript:`,
`JaVaScRiPt:`, `data:` und `vbscript:`.

**G2 — Laufzeit-Cache versioniert** — `data/kino.json` ist getrackt; jeder Serverlauf verschmutzt
das Arbeitsverzeichnis.
**Behoben:** `data/` steht in `.gitignore`, die Datei wurde per `git rm --cached` aus dem Index
genommen (bleibt auf der Platte).

**G3 — Toter Code-Pfad** — der `502`-Zweig (`server.js:71`) ist unerreichbar, da
`erstelleKinoprogramm()` alle Fehler pro Kino abfängt und nie wirft.
**Bewusst beibehalten:** Der Zweig wurde *nicht* entfernt, sondern als Absicherung kommentiert und
um ein `console.error` ergänzt. Eine Fehlerbehandlung zu löschen, nur weil sie im Normalbetrieb
nicht greift, würde den Request-Handler bei unerwarteten Fehlern abstürzen lassen.

**G4 — Inkonsistente Scraper-Signatur** — `holeStudiokino()` deklariert keinen Parameter, wird
aber über einen Wrapper (`lib/kino.js:303`) mit `heute` aufgerufen und ignoriert ihn. Als
einziger Scraper liefert er nie Uhrzeiten.
**Behoben:** einheitliche Signatur `holeStudiokino(heute)`, Wrapper entfernt. Dass die Seite keine
Uhrzeiten ausweist, bleibt bestehen — das Frontend zeigt dafür „siehe Webseite".

**G5 — Unvollständige Entity-Dekodierung** — `stripHtmlTags` (`lib/kino.js:37`) kennt vier
Entities; `&quot;`, `&#8220;` u. a. erscheinen roh.
**Behoben:** `dekodiereEntities()` löst numerische Entities generisch über den Codepoint auf
(dezimal und hexadezimal) und deckt 25 benannte ab.

**G6 — Kein Graceful Shutdown** — keine `SIGTERM`-Behandlung; `docker stop` killt nach 10 s hart.
**Behoben:** `SIGTERM`/`SIGINT` schließen den Server, ein `unref()`-Timer beendet notfalls nach
5 s. *Nachgewiesen:* Prozess beendet sich sauber mit Logeintrag.

**G7 — `npm install` statt `npm ci`** (`docker-compose.yml:7`) — umgeht das Lockfile-Pinning.
`playwright` 1.62.1 ist verfügbar, das Image ist auf `v1.61.1-noble` festgenagelt; Drift zwischen
Bibliothek und mitgeliefertem Browser ist möglich.
**Behoben:** `npm ci` in `docker-compose.yml` und in `ANLEITUNG-UNRAID.md` (beide Stellen
synchron); `.git` zusätzlich von der robocopy-Kopie ausgenommen.

### Ungenutzte Dateien / Dependencies

Keine ungenutzten Dependencies (`playwright` wird in `lib/kino.js:3` verwendet).
`Homeboard-starten.bat` ist Windows-spezifisch und im Container-Betrieb funktionslos — bewusst
für den lokalen Start vorgehalten, kein Befund.

---

## 3. Verbesserungsvorschläge

### Bestehender Code

| # | Vorschlag | Aufwand | Nutzen | behebt | Status |
|---|---|---|---|---|---|
| A1 | Scraper parallelisieren (`Promise.all` statt `for`) | niedrig | hoch | M2 | **umgesetzt** |
| A2 | `AbortSignal.timeout(10_000)` in allen `fetch()` | niedrig | hoch | M2 | **umgesetzt** |
| A3 | Bei fehlendem HTML-Anker explizit werfen | niedrig | hoch | M1 | **umgesetzt** |
| A4 | Nur persistieren, wenn ≥1 Kino Filme lieferte | niedrig | mittel | M4 | **umgesetzt** |
| A5 | Statische Auslieferung auf Allowlist umstellen | niedrig | mittel | M3 | **umgesetzt** |
| A6 | URL-Schema auf `http:`/`https:` prüfen | niedrig | mittel | G1 | **umgesetzt** |
| A7 | `data/kino.json` in `.gitignore`, aus Index nehmen | niedrig | mittel | G2 | **umgesetzt** |
| A8 | Graceful Shutdown (`SIGTERM` → `server.close()`) | niedrig | gering | G6 | **umgesetzt** |
| A9 | `npm ci` statt `npm install` im Compose-Command | niedrig | mittel | G7 | **umgesetzt** |
| A10 | Smoke-Test-Skript (`node --test`) | mittel | hoch | Testlücke | offen |
| A11 | Scraper-Signaturen vereinheitlichen | mittel | gering | G4 | **umgesetzt** |
| A12 | `index.html` aufteilen (nur bei weiterem Wachstum) | mittel | gering | — | offen |

### Funktionserweiterungen

| # | Vorschlag | Aufwand | Nutzen |
|---|---|---|---|
| B1 | Dritte Kachel füllen (Müllabfuhr, MVB-Abfahrten, Kalender) — Platzhalter existiert bereits | mittel | hoch |
| B2 | Auto-Refresh für den Wandtablet-Betrieb | niedrig | hoch |
| B3 | Wetter über den Server proxen (Caching, Client-Unabhängigkeit) | niedrig | mittel |
| B4 | Mehrtagesvorhersage (`forecast_days` 1 → 3–5) | niedrig | mittel |
| B5 | Kino-Vorschau auf morgen (Datumsparameter) | mittel | mittel |
| B6 | Cache-Alter im Frontend anzeigen | niedrig | mittel |

**Offen geblieben:** A10 (Smoke-Tests) und A12 (`index.html` aufteilen) sowie sämtliche
Erweiterungen B1–B6. Empfohlene Reihenfolge für den nächsten Schritt: A10 als Sicherheitsnetz,
danach B2 und B1.

---

## 4. Testlage

Es existiert **kein** Test-Framework: kein `test`-Script, keine Testdateien, keine CI-Konfiguration.
`npm test` bricht mit `Missing script: "test"` ab. Manuelle Verifikation siehe Definition of Done
in `CLAUDE.md`.
