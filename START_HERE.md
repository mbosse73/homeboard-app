# Repo-Onboarding

**Nutzung (ohne Slash-Command, funktioniert immer):**
1. Diese Datei als `START_HERE.md` ins Root-Verzeichnis des frisch geklonten Repos legen (oder per `curl`/Kopie dorthin bringen).
2. Claude Code im Repo-Ordner starten.
3. Eingeben: `Lies START_HERE.md und arbeite alle Phasen darin automatisch der Reihe nach ab.`

Das umgeht das aktuell bekannte Problem, dass Custom Slash Commands aus `.claude/commands/` nicht zuverlässig erkannt werden.

Du arbeitest die folgenden 6 Phasen **selbstständig und automatisch der Reihe nach ab**, ohne nach jeder Phase auf eine Rückmeldung zu warten. Gib am Ende jeder Phase eine kurze Zusammenfassung aus und gehe dann direkt zur nächsten über. Nimm in den Phasen 1–3 noch keine Code-Änderungen vor – das sind reine Analysephasen. Halte erst vor tatsächlichen Code-Änderungen (falls in Phase 5 vorgeschlagen) inne und frage nach expliziter Freigabe, bevor du diese umsetzt.

## Phase 0 – Vorbereitung
1. Prüfe den Git-Status (`git status`, `git branch`). Falls der Branch nicht sauber ist, notiere das in der Zusammenfassung, fahre aber fort.
2. Lege einen neuen Branch `claude/onboarding-analysis` an und wechsle dorthin.
3. Prüfe, ob die App lokal lauffähig ist: installiere Dependencies und versuche einen Build/Start. Dokumentiere Ergebnis und ggf. Fehler.
4. Prüfe, ob Tests vorhanden sind, und führe sie aus. Notiere: bestehen / fehlschlagen / keine vorhanden.

## Phase 1 – Initialisierung
Führe eine erste Bestandsaufnahme des Projekts durch (entspricht `/init`): grundlegende Projektinfos, Tech-Stack, Ordnerstruktur. Lege bzw. aktualisiere die `CLAUDE.md` mit diesen Basisinformationen.

## Phase 2 – Analyse & Überblick
Verschaffe dir einen vollständigen Überblick über die App:
- Architektur und Verzeichnisstruktur
- Verwendete Frameworks, Libraries und deren Versionen
- Haupteinstiegspunkte und zentrale Module
- Datenfluss / Datenmodell (falls relevant)
- Build- und Deployment-Prozess

## Phase 3 – Fehler- und Sicherheitsanalyse
Finde Fehler und Inkonsistenzen im Programm:
- Code-Smells, tote Code-Pfade, inkonsistente Namenskonventionen
- Fehlende oder unzureichende Fehlerbehandlung
- Veraltete oder verwundbare Abhängigkeiten (z. B. `npm audit` / `pip-audit` o. ä., je nach Stack)
- Hartcodierte Secrets, API-Keys oder andere sensible Daten im Code
- Ungenutzte Dependencies oder Dateien

Erstelle eine strukturierte Liste, priorisiert nach kritisch / mittel / gering.

## Phase 4 – Verbesserungs- und Erweiterungsvorschläge
Erarbeite auf Basis von Phase 2–3 konkrete Vorschläge für:
1. Verbesserungen am bestehenden Code (Refactoring, Architektur, Performance)
2. Sinnvolle Funktionserweiterungen

Bewerte jeden Vorschlag nach Aufwand (niedrig/mittel/hoch) und Nutzen (niedrig/mittel/hoch).

## Phase 5 – Projekt für effiziente Weiterarbeit einrichten
1. Aktualisiere die `CLAUDE.md` mit: Projektkontext, wichtigen Konventionen, häufig genutzten Befehlen (Build/Test/Start), bekannten Besonderheiten aus der Analyse.
2. Ergänze eine kurze Definition of Done: wie sollen künftige Änderungen verifiziert werden (welche Tests/Checks vor einem Commit laufen sollen).
3. Mache einen Vorschlag für sinnvolle Einträge in `.claude/settings.json` (z. B. Tool-Permissions/Allowlist) – schlage sie vor, wende sie aber nur nach expliziter Freigabe an.
4. Prüfe, ob eigene Skills oder repo-spezifische Slash-Commands für wiederkehrende Aufgaben in diesem Projekt sinnvoll wären, und schlage sie vor.
5. Notiere eine Backup-/Rollback-Empfehlung (z. B. Branch- oder Tag-Strategie vor größeren Änderungen).
6. Erstelle eine `ANALYSIS.md` im Repo, die die Ergebnisse aus Phase 2–4 dauerhaft festhält.

## Phase 6 – Abschluss
Fasse abschließend zusammen, was durchgeführt wurde (Analyseergebnisse, erstellte/aktualisierte Dateien, offene Punkte, die auf meine Freigabe warten). Führe danach eine Kontext-Bereinigung durch (entspricht `/compact`).
