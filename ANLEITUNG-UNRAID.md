# Homeboard unter Unraid betreiben (Compose Manager, ohne eigenes Image)

Kein eigenes Docker-Image, kein Build-Schritt: Der Container nutzt direkt das öffentliche
Playwright-Image (bringt Node.js + Chromium + alle Systemabhängigkeiten fertig mit), der komplette
App-Ordner wird als Volume eingebunden, und der Start-Befehl installiert die eine benötigte
npm-Abhängigkeit (`playwright`) und startet dann den Server. Gleiches Prinzip wie bei eurem
funktionierenden `dokumentenarchiv`-Stack (Image + `command` + Volume, kein `build:`).

## 1. Ordner auf dem Unraid-Server anlegen

```
/mnt/user/appdata/homeboard/
```

(per Unraid-Weboberfläche unter **Shares**, oder einfach per SMB-Freigabe anlegen lassen.)

## 2. Projektdateien dorthin kopieren

Von Windows aus per SMB-Freigabe, z. B. mit `robocopy`:

```powershell
$ziel = "\\<unraid-ip>\appdata\homeboard"
robocopy Z:\Programme\claude_programmiert\homeboard $ziel /E /XD node_modules data .claude .git test /XF *.bat
```

Danach sollte in `\\<unraid-ip>\appdata\homeboard\` liegen:

```
homeboard/
├── package.json
├── package-lock.json
├── server.js
├── index.html
├── app.css
├── app.js
└── lib/
    ├── kino.js
    ├── wetter.js
    ├── musik.js
    ├── http.js
    ├── datum.js
    └── text.js
```

(`node_modules`, `data`, `.claude`, `test`, `*.bat` werden nicht gebraucht — `node_modules` wird vom
Container selbst frisch für Linux erzeugt, `data` legt der Server beim ersten Start automatisch an,
und die Smoke-Tests laufen auf dem Entwicklungsrechner, nicht im Container.)

**Alle Dateien kopieren, auch die neuen.** Fehlt `app.css` oder `app.js`, lädt die Seite ohne
Gestaltung bzw. ohne Funktion — der Server liefert nur ausdrücklich freigegebene Dateien aus, und
diese beiden stehen auf der Liste.

## 3. Stack im Compose Manager anlegen

Docker-Tab → **Compose** → **Add New Stack** → Name `homeboard`.

Im Editor der `docker-compose.yml` folgenden Inhalt eintragen (liegt auch als Datei im Projekt):

```yaml
services:
  homeboard:
    image: mcr.microsoft.com/playwright:v1.61.1-noble
    container_name: homeboard
    working_dir: /app
    command: ["sh", "-c", "npm ci --omit=dev --no-audit --no-fund && node server.js"]
    ports:
      - "3080:3000"
    volumes:
      - /mnt/user/appdata/homeboard:/app
    environment:
      - PORT=3000
      - HOMEBOARD_DOCKER=1
      - TZ=Europe/Berlin
    restart: unless-stopped
```

Falls Port `3080` bei dir schon belegt ist, links (Host-Seite) einfach eine andere Zahl eintragen, z. B.
`"3090:3000"`.

**Save**, danach **Compose Up** klicken. Das Basis-Image wird beim ersten Mal heruntergeladen
(ca. 1,5–2 GB, enthält Chromium bereits fertig installiert), danach läuft `npm ci` (dauert nur
wenige Sekunden, da nur ein kleines JS-Paket nachinstalliert wird — der Chromium-Browser selbst ist
schon im Image enthalten) und startet den Server. Fortschritt im **Logs**-Fenster des Stacks
mitverfolgbar.

## 4. Aufrufen

```
http://<unraid-ip>:3080
```

Kinoprogramm-Kachel klicken. Erster Aufruf kann ~10–20 Sekunden dauern (Chromium scraped Moritzhof
live), danach ist es für 45 Minuten aus dem Cache sofort da. Über **Heute / Morgen** lässt sich die
Vorschau umschalten; der 🔄-Button erzwingt bei Bedarf ein sofortiges Neuladen.

Die Wetterdaten holt seit dieser Version der **Server** von Open-Meteo und nicht mehr der Browser.
Der Container braucht dafür Internetzugriff — den benötigt er für die Kinoseiten ohnehin.

Für den Wandtablet-Betrieb muss die Seite nicht mehr manuell neu geladen werden: die geöffnete
Ansicht aktualisiert sich selbst (Kino alle 15, Wetter alle 10 Minuten), und beim Zurückkehren zum
Tablet wird sofort nachgeladen. Neben dem Zeitstempel steht, wie alt der angezeigte Stand ist.

## 5. Aktualisieren

Geänderte Dateien erneut nach `\\<unraid-ip>\appdata\homeboard\` kopieren (Schritt 2 wiederholen),
danach im Compose Manager beim Stack auf **Compose Down** und dann **Compose Up** klicken (oder den
Container im Docker-Tab einfach neu starten). Kein Rebuild nötig — der Container liest beim Start
immer die aktuellen Dateien aus dem eingebundenen Ordner.

## Troubleshooting

**Seite lädt, aber "Kinodaten konnten nicht geladen werden"**
Stack-**Logs** im Compose Manager öffnen. Meist entweder kein Internetzugriff des Containers, oder eine
der vier Kino-Seiten meldet gerade selbst einen Fehler (steht dann konkret im Log, z. B. "CineStar API:
HTTP 500").

**Container startet nicht / "Cannot find module" in den Logs**
Ordner `\\<unraid-ip>\appdata\homeboard\` prüfen — fehlt eine Datei aus der Liste in Schritt 2
(insbesondere `lib/http.js`, `lib/datum.js`, `lib/text.js`, `lib/wetter.js` oder `lib/musik.js`),
war der Kopiervorgang unvollständig.

**Seite ohne Gestaltung / Buttons ohne Funktion**
`app.css` bzw. `app.js` fehlt im Zielordner. Schritt 2 wiederholen.

**Wetter-Kachel meldet einen Fehler, Kino funktioniert**
Der Server erreicht `api.open-meteo.com` nicht. Netzwerkeinstellungen des Containers prüfen; die
Kachel zeigt bei einer kurzen Störung weiterhin den letzten geladenen Stand samt Altersangabe.

**Alben-Kachel meldet „keine Albumzeilen erkannt" oder „kein Erscheinungsdatum gefunden"**
Das ist der beabsichtigte laute Fehler: tonspion hat den Aufbau der Seite geändert, und der
Scraper erfindet lieber nichts. Die Kachel zeigt weiter den letzten gespeicherten Stand mit einem
Hinweis darüber. Der Scraper in `lib/musik.js` muss dann an das neue Markup angepasst werden.

**Alben werden angezeigt, aber ohne Cover**
Die Cover kommen aus der iTunes-Suche, nicht von tonspion. Erreicht der Server
`itunes.apple.com` nicht, bleiben die Platzhalter stehen — die Liste selbst funktioniert weiter.

**Das Datum über den Alben ist nicht der heutige Freitag**
Kein Fehler: angezeigt wird immer das Datum, das auf der tonspion-Seite über den Alben steht.
Solange dort noch die Vorwoche steht, zeigt das Homeboard bewusst auch die Vorwoche.

**Im `data`-Ordner liegt noch eine alte `kino.json`**
Kein Problem: der Server heißt seine Cache-Dateien inzwischen `kino-<datum>.json` und räumt die alte
Datei beim nächsten Start selbst weg.

**"Failed to launch browser" in den Logs**
In der `docker-compose.yml` unter `homeboard:` zusätzlich eine Zeile ergänzen:

```yaml
    shm_size: "1gb"
```

Danach **Compose Up** erneut.
