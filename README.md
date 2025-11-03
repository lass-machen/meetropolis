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
2. `.env` erstellen (lokal). Beispiel siehe unten und Variablen anpassen.
3. Abhängigkeiten installieren:
   - Mit npm Workspaces: `npm install`
4. Prisma Client generieren und Datenbank migrieren:
   - `npm run generate`
   - `npm run prisma:migrate` (erstellt Initialschema)
5. Dev-Umgebung starten:
   - `docker compose up --build`
   - Alternativ lokal (ohne Docker) in zwei Terminals: `npm run dev` (startet Web und Server)

Web: `http://localhost:5173`  |  Server: `http://localhost:2567`  |  LiveKit: `http://localhost:7880`

#### Beispiel `.env` (lokal)
```
# Server / Datenbank
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meetropolis
LOG_LEVEL=info
PORT=2567

# LiveKit (lokal)
LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Web-Client
VITE_API_BASE=http://localhost:2567
VITE_LIVEKIT_URL=ws://localhost:7880
VITE_DEBUG_LOGS=true
VITE_FEATURE_AV_SETTINGS=true
VITE_FEATURE_VOICE_ISOLATION=client
# Optional
# VITE_FEATURE_VOICE_ONLY=true
# VITE_AV_FORCE_RELAY=false
VITE_HMR_HOST=localhost
VITE_HMR_PROTOCOL=ws

# CORS für lokale Web-Ports
CORS_ORIGIN=http://localhost:5173,http://localhost:5174

# Nur Dev (nicht für Prod verwenden)
API_TOKEN_PEPPER=dev-pepper-change-me
JWT_SECRET=dev-jwt-secret-change-me
```

#### API-Tokens
Mit persönlichen API-Tokens kannst du Mikrofon, Kamera, Screenshare und den Nicht-stören-Modus remote steuern – solange dein Benutzer online ist.

1) Token erstellen
- In der Web-App oben rechts „API-Tokens & Doku“ öffnen und „Neuen Token erstellen“ klicken. Der Klartext-Token wird nur einmal angezeigt – sicher speichern.

2) Token verwenden
- Setze den HTTP Header `Authorization: Bearer <DEIN_TOKEN>`.
- Endpoint:
  - `POST /controls`
  - Body (JSON, mindestens ein Feld): `{ "mic": true|false, "cam": true|false, "share": true|false, "dnd": true|false }`

Beispiel (cURL):
```
curl -X POST "http://localhost:2567/controls" \
  -H "Authorization: Bearer DEIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mic": false, "dnd": true }'
```

3) Token löschen
- Im gleichen Dialog können Tokens gelöscht werden. Gelöschte Tokens sind sofort ungültig.

Hinweise
- In Produktion muss `API_TOKEN_PEPPER` gesetzt sein (erzwungen). In Dev ist ein Ephemeral-Pepper aktiv; bei Server-Neustart werden alte Tokens ungültig.
- Der Endpoint antwortet mit `409`, wenn dein Benutzer nicht online ist, und mit `401`, wenn der Token ungültig ist.

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


#### Lizenz & Editionen

- Kern des Projekts ist **Open Source unter Apache-2.0** (siehe `LICENSE`, `NOTICE`).
- Mandanten-Funktionen werden als **proprietäre Edition** separat gepflegt und sind nicht Teil der Open-Source-Distribution.
- Marken (Name/Logo) sind separat geregelt, siehe `TRADEMARKS.md`.

Erlaubt (Auszug):
- Nutzung, Veränderung und Weitergabe gemäß Apache-2.0.

Nicht über die OSS-Edition abgedeckt:
- Multi-Tenant-Funktionalität, Wiederverkauf als Service/Produkt unter Nutzung der Marken, oder Behauptung einer offiziellen Distribution.

Für eine kommerzielle Lizenz der Mandanten-Edition kontaktiere uns bitte.