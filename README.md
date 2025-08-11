### Meetropolis (MVP Scaffold)

Ein internes Gather.town-ähnliches MVP mit Monorepo-Struktur.

#### Inhalte
- Monorepo mit `apps/web`, `apps/server`, `packages/shared`
- Docker Compose für Web (Vite), Server (Colyseus + Prisma), LiveKit und Postgres
- Prisma Schema (User, Room, Zone, Map, Presence)
- Colyseus WorldRoom (minimaler Weltzustand)
- Minimaler Phaser 3 Scene-Start, lädt Tiled JSON Map
- `.env.example` für lokale Variablen

#### Voraussetzungen
- Node.js 20+
- Docker & Docker Compose

#### Setup
1. Repo klonen und ins Projekt wechseln.
2. `.env.example` nach `.env` kopieren und ggf. Variablen anpassen.
3. Abhängigkeiten installieren:
   - Mit npm Workspaces: `npm install`
4. Prisma Client generieren und Datenbank migrieren:
   - `npm run generate`
   - `npm run prisma:migrate` (erstellt Initialschema)
5. Dev-Umgebung starten:
   - `docker compose up --build`
   - Alternativ lokal (ohne Docker) in zwei Terminals: `npm run dev` (startet Web und Server)

Web: `http://localhost:5173`  |  Server: `http://localhost:2567`  |  LiveKit: `http://localhost:7880`

#### LiveKit (Entwicklung)
- Der Compose-Container startet LiveKit im Dev-Modus mit Schlüsseln `devkey/secret` auf Port `7880`.
- Der Web-Client liest `VITE_LIVEKIT_URL` und der Server `LIVEKIT_URL` aus `.env`.

#### Ordnerstruktur
```
apps/
  server/
    prisma/
    src/
  web/
    src/
packages/
  shared/
```

#### Nächste Schritte
- Bewegung/Präsenz, LiveKit-Basis, Bubble/Zone-Logik, Follow & Editor gemäß Prozess in der Aufgabenbeschreibung implementieren.

