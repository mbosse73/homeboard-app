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
robocopy Z:\Programme\claude_programmiert\homeboard $ziel /E /XD node_modules data .claude /XF *.bat
```

Danach sollte in `\\<unraid-ip>\appdata\homeboard\` liegen:

```
homeboard/
├── package.json
├── package-lock.json
├── server.js
├── index.html
└── lib/
    └── kino.js
```

(`node_modules`, `data`, `.claude`, `*.bat` werden nicht gebraucht — `node_modules` wird vom Container
selbst frisch für Linux erzeugt, `data` legt der Server beim ersten Start automatisch an.)

## 3. Stack im Compose Manager anlegen

Docker-Tab → **Compose** → **Add New Stack** → Name `homeboard`.

Im Editor der `docker-compose.yml` folgenden Inhalt eintragen (liegt auch als Datei im Projekt):

```yaml
services:
  homeboard:
    image: mcr.microsoft.com/playwright:v1.61.1-noble
    container_name: homeboard
    working_dir: /app
    command: ["sh", "-c", "npm install --omit=dev --no-audit --no-fund && node server.js"]
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
(ca. 1,5–2 GB, enthält Chromium bereits fertig installiert), danach läuft `npm install` (dauert nur
wenige Sekunden, da nur ein kleines JS-Paket nachinstalliert wird — der Chromium-Browser selbst ist
schon im Image enthalten) und startet den Server. Fortschritt im **Logs**-Fenster des Stacks
mitverfolgbar.

## 4. Aufrufen

```
http://<unraid-ip>:3080
```

Kinoprogramm-Kachel klicken. Erster Aufruf kann ~10–20 Sekunden dauern (Chromium scraped Moritzhof
live), danach ist es für 45 Minuten aus dem Cache sofort da. 🔄-Button erzwingt bei Bedarf ein
sofortiges Neuladen.

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
Ordner `\\<unraid-ip>\appdata\homeboard\` prüfen — fehlt `package.json` oder `server.js`, war Schritt 2
unvollständig.

**"Failed to launch browser" in den Logs**
In der `docker-compose.yml` unter `homeboard:` zusätzlich eine Zeile ergänzen:

```yaml
    shm_size: "1gb"
```

Danach **Compose Up** erneut.
