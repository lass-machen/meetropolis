### AGENTS – Arbeitsrichtlinien für sauberen Code und effiziente Zusammenarbeit

Diese Datei richtet sich an Entwicklerinnen/Entwickler und automatisierte Agents, die in diesem Monorepo arbeiten. Ziel ist ein konsistenter, wartbarer Code mit klaren Qualitätsbudgets und einem zuverlässigen Arbeitsprozess.

## Zweck & Grundprinzipien

- **Klarheit vor Cleverness**: Bevorzuge lesbaren, testbaren Code gegenüber „smarten“ Einzeilern.
- **Kleine Einheiten**: Kurze Funktionen und kleine Module, Single Responsibility.
- **Explizite Typen**: TypeScript strict ist aktiv; nutze starke Typisierung, keine `any`-Abkürzungen.
- **Stabile Architektur**: Gemeinsame Logik in `packages/shared`; trenne UI, Game-Logik und Server klar.
- **Re-Use vor Neu**: Bevor du Neues baust, prüfe Wiederverwendung bestehender Komponenten/Hooks.

## Monorepo-Struktur (Überblick)

- `apps/server`: Express + Colyseus; Prisma unter `apps/server/prisma/`, Source in `apps/server/src/`.
- `apps/web`: React + Vite + Phaser; Source in `apps/web/src/`, Assets unter `apps/web/public/`.
- `packages/shared`: Wiederverwendbare Typen/Utils (`packages/shared/src/`).

## Qualitätsbudgets (harte Leitplanken)

- **Dateigrößen (Quellcode)**
  - React/TS/Server-Dateien: Ziel ≤ 400 LoC, absolut ≤ 600 LoC.
  - Phaser Scene-Dateien: Ziel ≤ 300 LoC, absolut ≤ 800 LoC. Scene-Klassen
    implementieren den Phaser-Lifecycle-Contract (preload/create/update +
    große öffentliche Oberfläche für Helper-Module). Delegation an Manager-
    Klassen ist gewünscht; weitere Zerlegung via Mixins schafft `this`-
    Kopplung und ist explizit ausgeschlossen.
  - Utility-Module: Ziel ≤ 300 LoC, absolut ≤ 450 LoC.
  - Wenn > Ziel: vor Merge aufteilen. Falls absolut überschritten: Blocker bis Refactor.
- **Funktionen/Komponenten**
  - Funktion/Komponente: Ziel ≤ 50 LoC, absolut ≤ 80 LoC.
  - Ausnahme: Composite-Hooks (Dateinamen-Muster `use*Composite.ts`) dürfen
    bis zu 120 LoC pro Body verwenden, weil React-Hook-Order erzwingt, dass
    alle Sub-Hooks in einem einzigen Render-Pass aufgerufen werden.
  - Max. 1-2 Verantwortlichkeiten; extrahiere Hooks/Utils.
- **Exporte pro Datei**
  - Bevorzuge 1 primären Default/Named-Export, wenige unterstützende Exporte. Viele Exporte → Datei splitten.
- **Komplexität**
  - Tiefe Verschachtelung max. 3 Ebenen. Nutze Early Returns statt großer if/else-Blöcke.

Begründete Ausnahmen werden in `.budgetignore` mit einer schriftlichen
Begründung dokumentiert. PRs, die ein bisher konformes File über das harte
Limit drücken, werden abgelehnt.

## Architekturregeln

- **Schichten**: `packages/shared` (typen/util) ← `apps/*` (Anwendung) – keine Imports aus `apps/*` nach `packages/*`.
- **Zustand**: Globaler Zustand via `zustand` in `apps/web/src/state/`; UI-lokaler Zustand in Komponenten/Hooks.
- **Kommunikation**: Server via Colyseus; AV via LiveKit; HTTP nur für Admin/API-Funktionen.
- **Trennung**: UI (React), Game (Phaser), Realtime (Colyseus/LiveKit) klar entkoppeln über schmale Bridges (`apps/web/src/game/bridge.ts`).

## Frontend (React + Vite + Phaser)

- **Namensgebung**: Komponenten `PascalCase.tsx`; Hooks/Utils `camelCase.ts`.
- **Komponenten-Aufteilung**: Presentational vs. Container; wiederverwendbare Bausteine in `apps/web/src/ui/`.
- **Hooks**: Logik extrahieren (`useXyz`), keine Heavy-Logic in JSX.
- **Assets**: Unter `apps/web/public/assets/` bzw. `public/maps/`; große Binärdateien vermeiden.
- **Performance**: `memo`, `useMemo`, `useCallback` gezielt; Listen virtualisieren; keine teuren Berechnungen im Render.
- **A11y**: Semantische HTML-Tags, Fokus-Management, Tastaturbedienbarkeit.

## Game (Phaser)

- **Scenes** enden auf `Scene` (z. B. `MainScene.ts`).
- **Entkopplung**: Keine direkten React-Imports; Kommunikation über klar definierte Bridge-Events.
- **Update-Schritte** kurz halten; zeitkritische Pfade ohne Allokationen im Loop.

## Server (Express + Colyseus + Prisma)

- **Ordnung**: Routen/Handler sauber strukturieren; Rooms in `apps/server/src/rooms/`.
- **Prisma**: Migrationen klein und nachvollziehbar; `npm run generate`/`npm run prisma:migrate` verwenden.
- **Fehler**: Keine nackten Throws in Route-Handlern; antworte konsistent mit Codes/Fehlermeldungen.
- **Logging**: `pino` nutzen; Level dev=debug, prod=info; keine sensiblen Daten loggen.

## Typisierung & Stil

- TS strict ist aktiv (siehe `tsconfig.base.json`).
- Keine `any`/`as unknown as`-Hacks; generische Typen bevorzugen.
- Strings mit einfachen Anführungszeichen; Semikolons; Einrückung 2 Leerzeichen.

## Fehlerbehandlung

- Guard-Clauses statt Pyramid-of-Doom.
- Kein Leerschlucken von Fehlern; Exceptions nur mit sinnvoller Behandlung.

## Tests

- **Unit**: Leichte, deterministische Tests in Nähe der Module (`*.test.ts`).
- **Web**: `vitest`; für UI-Logik Testing-Library.
- **E2E**: Playwright-Spezifikationen im Ordner `apps/web/e2e/` (falls passend erweitern).
- **Mindestens**: Neue Logik erhält Basis-Unit-Tests; Regressions-Bugs erhalten Tests.

## Git, Commits & PRs

- Branches: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Commits: kurz, im Imperativ, ein Anliegen pro Commit.
- PRs: Beschreibung, Setup/Run-Notizen, Testplan; bei UI/Game Änderung Screenshots oder kurze Clips; veränderte Env-Vars dokumentieren.
- Keine gemischten Anliegen in einem PR.

## Sicherheit & Konfiguration

- Keine Secrets commiten. `.env.example` als Vorlage nutzen (`DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VITE_*`).
- Docker-Setup nutzen (`docker compose up --build`).

## Vor dem Merge – lokale Checks

- `npm install` im Repo-Root (Workspaces).
- `npm run build` (baut Web und Server).
- `npm -w @meetropolis/web run test` (falls relevant).
- Manuelle Smoke-Tests: Web `http://localhost:5173`, Server `http://localhost:2567`.

## Umgang mit großen/gewachsenen Dateien

Wenn eine Datei die Budgets überschreitet, plane eine sofortige Aufteilung. Beispiel `apps/web/src/App.tsx` → sinnvolle Teilung:

- `apps/web/src/app/providers/*` (Sentry, Routing, Stores, AV-Kontext)
- `apps/web/src/app/routes/*` (Route- und Screen-Komponenten)
- `apps/web/src/app/layout/*` (Layout, Overlays, Bars)
- `apps/web/src/features/*` (in sich geschlossene Feature-Verticals)
- `apps/web/src/app/appRoot.tsx` (leichter Einstiegspunkt)

## Review-Checkliste (Kurzform)

- Hält der PR alle Qualitätsbudgets ein (Datei-/Funktionsgrößen)?
- Klare Verantwortlichkeiten, keine zyklischen Abhängigkeiten?
- Typen vollständig und präzise? Keine `any`-Abkürzungen?
- Tests vorhanden/aktualisiert? Manuelle Schritte dokumentiert?
- Logging, Fehlerfälle, Performance (Render/Loop) bedacht?
- Keine Secrets, Env-Änderungen dokumentiert?

## Arbeitsregeln für automatisierte Agents

- Kleine, fokussierte Edits; keine Format-Overhauls unbeteiligter Dateien.
- Bestehende Einrückung/Formatierung respektieren; nur minimal nötige Änderungen.
- Vor Edits: kurze Bestandsaufnahme; nach Edits: kurze Zusammenfassung der Wirkung.
- Wenn Tests/Lints verfügbar: ausführen und Fehler beheben oder klar kommunizieren.
- Dateien, die Budgets überschreiten, nicht weiter aufblähen – zuerst aufteilen.
- Keine neuen Abhängigkeiten ohne Begründung und Zustimmung im PR-Text.

## Definition of Done

- Budgets eingehalten oder begründete Ausnahme + Follow-up-Ticket.
- Build grün; Basis-Tests vorhanden/aktualisiert.
- PR-Beschreibung inkl. Testplan und ggf. Medien.
- Reviewer-Feedback eingearbeitet.
