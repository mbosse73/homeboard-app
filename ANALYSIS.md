# Analyse Homeboard

Ergebnis des Onboarding-Durchlaufs vom 14.08.2026 (Phasen 2–4 aus `START_HERE.md`).
Stand des untersuchten Codes: Commit `4d88287`.

> **Status:** Alle elf Befunde aus Abschnitt 2 sind behoben. Die Befundtexte bleiben als
> Dokumentation des ursprünglichen Zustands stehen; jeder trägt einen Hinweis auf die Umsetzung.
> Aus Abschnitt 3 sind **A1–A12 und B1–B6** umgesetzt — damit ist der gesamte Abschnitt erledigt.
> Beim Schreiben der Smoke-Tests (A10) kam ein zwölfter Befund hinzu, siehe **M5**.

---

## 1. Überblick

**Homeboard** ist ein privates LAN-Dashboard mit drei Funktionen: Kinoprogramm Magdeburg
(vier Kinos), Wetter Magdeburg und die Musik-Neuerscheinungen der Woche. Es läuft als
Node-Server, üblicherweise als Docker-Container auf einem Unraid-Server.

### Architektur

Drei Schichten mit genau einer Kopplung zwischen Server und Datenbeschaffung
(`erstelleKinoprogramm()`):

Untersuchter Stand (drei Schichten, eine Kopplung über `erstelleKinoprogramm()`):

```
index.html    Präsentation — View-Umschaltung ohne Router, CSS+JS inline
   ↓ fetch
server.js     HTTP, Cache-Logik, statische Auslieferung
   ↓ require
lib/kino.js   Vier Kino-Scraper
```

Heutiger Stand nach A12 und B3 — Präsentation aufgeteilt, Wetter nicht mehr am Server vorbei:

```
index.html / app.css / app.js   Präsentation, weiterhin ohne Build-Schritt
   ↓ fetch /api/kino, /api/wetter
server.js                       HTTP, Cache pro Datum, statische Allowlist
   ↓ require
lib/kino.js   lib/wetter.js     Datenbeschaffung
   ↓ require
lib/http.js   lib/datum.js      Zeitlimits, Kalendertage in Europe/Berlin
```

### Einstiegspunkte

| Datei | Funktion |
|---|---|
| `server.js` | `server.listen()` |
| `lib/kino.js` | `erstelleKinoprogramm(datum)` |
| `lib/wetter.js` | `holeWetter()` |
| `app.js` | Frontend-Bootstrap |

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

- **Kino:** Browser → `/api/kino?tag=…` → RAM-Cache pro Datum (45 min TTL) → bei Miss vier Scraper
  → `data/kino-<datum>.json`
- **Wetter:** Browser → `/api/wetter` → RAM-Cache (15 min TTL) → bei Miss `api.open-meteo.com`
  (vor B3: Browser sprach Open-Meteo direkt an, ohne Server-Beteiligung)

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

**M5 — Abschnittsgrenze „Demnächst" nur als Literal gesucht** (`lib/kino.js`)
Nachgereicht: beim Schreiben der Smoke-Tests (A10) aufgefallen, nicht in der ursprünglichen
Durchsicht. Der Studiokino-Scraper schneidet den Tagesabschnitt bei `indexOf('Demnächst')` ab.
Steht der Umlaut im Quelltext als Entity (`Demn&auml;chst`), greift die Grenze nicht, der Abschnitt
reicht bis zum Dokumentende — und die Vorschaufilme aus „Demnächst" erscheinen ohne Spieltermin im
heutigen Programm. Anders als M1 fällt das nicht auf: es entsteht kein Fehler, nur falsche Daten.
*Reproduziert:* Fixture mit `Demn&auml;chst` liefert 2 statt 1 Film.
**Behoben:** `ersterIndex()` prüft `Demnächst`, `Demn&auml;chst` und `Demn&#228;chst`. Beide
Schreibweisen sind durch je einen Test abgedeckt.

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
| A10 | Smoke-Test-Skript (`node --test`) | mittel | hoch | Testlücke, M5 | **umgesetzt** |
| A11 | Scraper-Signaturen vereinheitlichen | mittel | gering | G4 | **umgesetzt** |
| A12 | `index.html` aufteilen | mittel | gering | — | **umgesetzt** |

### Funktionserweiterungen

| # | Vorschlag | Aufwand | Nutzen | Status |
|---|---|---|---|---|
| B1 | Dritte Kachel füllen — geworden ist es „Neue Alben" (Musik-Neuerscheinungen der Woche) | mittel | hoch | **umgesetzt** |
| B2 | Auto-Refresh für den Wandtablet-Betrieb | niedrig | hoch | **umgesetzt** |
| B3 | Wetter über den Server proxen (Caching, Client-Unabhängigkeit) | niedrig | mittel | **umgesetzt** |
| B4 | Mehrtagesvorhersage (`forecast_days` 1 → 3–5) | niedrig | mittel | **umgesetzt** |
| B5 | Kino-Vorschau auf morgen (Datumsparameter) | mittel | mittel | **umgesetzt** |
| B6 | Cache-Alter im Frontend anzeigen | niedrig | mittel | **umgesetzt** |

### Anmerkungen zur Umsetzung

- **A12:** aufgeteilt in `index.html` (Markup), `app.css` und `app.js`. Kein Build-Schritt, die
  beiden neuen Dateien stehen in `OEFFENTLICHE_DATEIEN`. Das Theme-Bootstrap bleibt bewusst inline
  im `<head>` — als externe Datei würde beim Laden kurz der falsche Farbmodus aufblitzen.
- **B2:** kein eigener Timer je Ansicht, sondern ein 30-Sekunden-Tick, der prüft, ob die
  *sichtbare* Ansicht veraltet ist. Erzwungen (`refresh=1`) wird dabei nie — über die Frische
  entscheidet der Server-Cache. Derselbe Tick hält das Kopfdatum über Mitternacht hinweg aktuell
  und verwirft dann den angezeigten Stand; ein Tablet, das wochenlang durchläuft, zeigte sonst
  dauerhaft den Tag des letzten Reloads.
- **B3:** Der Browser spricht Open-Meteo nicht mehr direkt an. Scheitert der Abruf, liefert der
  Server den letzten brauchbaren Stand weiter statt eines Fehlers — die Kachel bleibt gefüllt, und
  über die Altersangabe (B6) ist erkennbar, wie frisch sie ist.
- **B4:** `forecast_days=5`. Die Stundenleiste wird serverseitig auf 24 Stunden **ab der laufenden
  Stunde** beschnitten; ohne das hätte sie 120 Einträge, und die alte Markierung „jetzt" (Vergleich
  nur der Stundenzahl) hätte an fünf Stellen zugleich gegriffen.
- **B5:** `tag=heute|morgen` statt eines freien Datumsparameters — jeder beliebige Wert würde sonst
  einen Scrape gegen vier Fremdseiten auslösen. Drei der vier Kinos liefern eine Vorschau; das
  Studiokino veröffentlicht nur den laufenden Tag und meldet das über das neue Feld `hinweis`.
  Damit hat ein Kino genau einen von drei Zuständen: Filme, Hinweis oder Fehler. Der Cache ist
  jetzt pro Datum getrennt (`data/kino-<datum>.json`), veraltete Dateien räumt der Start weg.

- **B1:** Die dritte Kachel zeigt die Musik-Neuerscheinungen der Woche von
  `tonspion.de/news/musik-neuerscheinungen-neue-alben`. Drei Entscheidungen prägen die Umsetzung:

  1. **Das Datum wird gelesen, nicht gerechnet.** Verbindlich ist die Datumsangabe in der
     Überschrift der Quelle. Der naheliegende Weg — „heute ist Freitag, also sind das die neuen
     Alben" — wäre falsch, sobald die Seite noch nicht aktualisiert wurde. Lieber ein sichtbar
     alter Stand als alte Alben, die als neu ausgegeben werden.
  2. **Cover kommen aus einer zweiten Quelle.** tonspion liefert sie nicht; gesucht wird über die
     iTunes-Suche (kein Schlüssel nötig, kein zusätzliches Paket). Der Interpretenname des
     Treffers muss zum gesuchten passen, sonst bleibt das Cover leer — ein Karaoke-Cover wäre
     schlimmer als gar keins. Jede Suche ist einzeln abgesichert: ein Fehlschlag kostet nie den
     Albumeintrag, das Frontend zeigt dann einen Platzhalter in gleicher Größe.
  3. **Der Parser scheitert laut.** Ohne erkennbares Datum oder ohne eine einzige Albumzeile wird
     geworfen, statt eine leere Liste zurückzugeben — die sähe aus wie „diese Woche erscheint
     nichts". Die Fehlermeldung nennt, wie viele Überschriften bzw. Textblöcke geprüft wurden,
     damit eine Layoutänderung schnell einzugrenzen ist.

  Die gemeinsamen HTML-Werkzeuge beider Scraper stehen jetzt in `lib/text.js`; `lib/kino.js`
  nutzt sie unverändert weiter.

**Einschränkung:** Das Markup von tonspion.de war während der Umsetzung nicht abrufbar (die Seite
ist aus der Entwicklungsumgebung gesperrt). Die Regeln des Parsers sind gegen einen nachgebauten
Fixture getestet, nicht gegen die echte Seite — der erste Lauf auf dem Server muss zeigen, ob sie
greifen. Scheitert er, sagt die Fehlermeldung, an welcher Stelle.

---

## 4. Testlage

`npm test` startet `node --test` mit fünf Dateien unter `test/` (52 Tests, ~1,8 s). Kein
Test-Framework als Dependency — Bordmittel reichen und passen zum dependency-armen Ansatz.

| Datei | Deckt ab |
|---|---|
| `test/helfer.test.js` | `sichereUrl`, Entity-Dekodierung, Kürzung, Datumshelfer |
| `test/kino.test.js` | Scraper gegen HTML-/JSON-Fixtures, Fehlerisolation, Parallelität, Zeitlimit |
| `test/wetter.test.js` | Normalisierung, Stundenausschnitt, defekte Antworten |
| `test/musik.test.js` | Datumserkennung, Albumzeilen, lautes Scheitern, Cover-Zuordnung |
| `test/server.test.js` | Allowlist, `tag`-Validierung, Wetter- und Alben-Cache, keine Persistenz bei Totalausfall |

Die Tests laufen **ohne Netzzugriff**: `globalThis.fetch` wird ersetzt, der Server startet mit
`PORT=0`. Moritzhof lässt sich so nicht stubben (Playwright statt `fetch`) und scheitert im Test —
genau das prüft der Isolationstest mit. Eine CI-Konfiguration gibt es weiterhin nicht.

Nicht durch Tests abgedeckt und weiterhin nur manuell prüfbar (siehe Definition of Done in
`CLAUDE.md`): das tatsächliche Scraping gegen die echten Kino- und tonspion-Seiten.
