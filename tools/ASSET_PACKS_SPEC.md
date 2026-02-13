## Ziel

- Einheitliches Bundle-Format für Asset Packs (.zip) mit `config.json` + `assets/` Ordner.
- Serverseitige Installation, Auflistung, Abruf und Deinstallation.
- Globale Installation (Option A): Alle installierten Packs stehen allen Maps zur Verfügung.
- Pro `uuid` nur genau eine installierte Version; Re-Upload ersetzt; Upgrade migriert referenzierte Items (Dimensions-Check).
- Monolithische Speicherung der Items (`terrain`, `structures`, `objects`) als JSON-Spalten.
- Frontend-/Editor-Integration ist hier bewusst out of scope (separates Dokument).

## Scope

- Backend: Datenbankmodell (Prisma), Migrationsplan, Upload-/Installations-Endpoint, Auflisten/Abrufen/Löschen, Storage/Static-Serving, Validierung, Upgrade-/Ersetzungsregeln.
- Kein Docker-Volume, lokale Speicherung unter Server `public/`.
- AuthZ: Alle eingeloggten User dürfen Packs hochladen/löschen.

## Datenmodell (Prisma)

- Tabelle `AssetPack` (neues Modell):
  - `id` (Int, autoincrement, PK)
  - `uuid` (String, unique)
  - `name` (String)
  - `description` (String)
  - `author` (String)
  - `version` (String)
  - `terrain` (Json)
  - `structures` (Json)
  - `objects` (Json)
  - `createdAt` (DateTime @default(now()))
  - `updatedAt` (DateTime @updatedAt)

Einmalige Version pro `uuid`: Es existiert höchstens ein Datensatz je `uuid`. Upload gleicher `uuid` mit anderer `version` ersetzt (nach bestandenem Dimensions-Check) die installierte Version komplett.

### Prisma-Modelleintrag (`apps/server/prisma/schema.prisma`)

```prisma
model AssetPack {
  id          Int      @id @default(autoincrement())
  uuid        String   @unique
  name        String
  description String
  author      String
  version     String

  terrain     Json
  structures  Json
  objects     Json

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Bundle-Format (.zip)

- Root:
  - `config.json` (Pflicht)
  - `assets/` (Pflicht) – enthält alle referenzierten Bilddateien
- Erlaubte Asset-Dateitypen: vorerst `.png`, `.webp`.

### config.json (Schema)

- Pack-Metadaten (Pflicht): `uuid` (UUID), `name`, `description`, `author`, `version` (String)
- Items als Arrays:
  - `terrain`: Tilesets (Grid-basiert)
  - `structures`: Sprites
  - `objects`: Sprites

Gemeinsame Item-Felder:
- `id` (string; stabil pack-intern über Versionen)
- `key` (string; technischer Name)
- `category`: `"terrain" | "structure" | "objects"`
- `dataURL`: Pfad relativ zu `assets/`
- `collide`: boolean
- `placement`: `"any" | "floor" | "wall"`
- `scaleFactor` (number, optional, default 1.0) — rendering scale factor for the asset (e.g. 0.5 for 2x assets)
- optional: `anchor` {x,y}, `offset` {x,y}, `zIndex` (int), `rotationAllowed` (bool), `flipAllowed` (bool)

Terrain-spezifisch (Tileset):
- `tileWidth` (int, Pflicht), `tileHeight` (int, Pflicht)
- `margin` (int, default 0), `spacing` (int, default 0)
- Hinweis: Bei `terrain` entfallen `width`/`height`. Bei `structure`/`objects` sind `width`/`height` Pflicht.

### Beispiel `config.json`

```json
{
  "uuid": "c5e4f1a8-1234-5678-90ab-ffffffffffff",
  "name": "Office Basics",
  "description": "Böden, Wände, Möbel",
  "author": "ACME",
  "version": "1.2.0",
  "terrain": [
    {
      "id": "office_tiles_v1",
      "key": "office_tiles",
      "category": "terrain",
      "dataURL": "tilesets/office_tiles.png",
      "tileWidth": 16,
      "tileHeight": 16,
      "margin": 0,
      "spacing": 0,
      "collide": false,
      "placement": "floor"
    }
  ],
  "structures": [
    {
      "id": "wall_gray",
      "key": "wall_gray",
      "category": "structure",
      "dataURL": "structures/wall_gray.png",
      "width": 16,
      "height": 16,
      "placement": "wall",
      "collide": true
    }
  ],
  "objects": [
    {
      "id": "chair_blue",
      "key": "chair_blue",
      "category": "objects",
      "dataURL": "objects/chair_blue.png",
      "width": 16,
      "height": 16,
      "placement": "floor",
      "collide": false
    }
  ]
}
```

## Storage & Static Serving

- Zielverzeichnis: `apps/server/public/packs/<uuid>/...`
  - Kein Versions-Unterordner. Installation/Upgrade überschreibt das Verzeichnis vollständig (entsprechend der Vorgabe: immer nur die Dateien der installierten Version vorhanden).
- Datei-Hashing: Jede Asset-Datei wird content-gehasht (SHA-256, z. B. 8 Hex-Zeichen) und umbenannt:
  - Muster: `<basename>.<hash8>.<ext>` (z. B. `chair_blue.ab12cd34.png`).
  - Unterordner-Struktur aus ZIP bleibt erhalten.
- Referenz-Umschreibung: In `terrain/structures/objects` werden `dataURL` auf die servbaren Pfade umgeschrieben: `/packs/<uuid>/<subpath>/<file>.<hash>.<ext>`. Optional bleibt `originalPath` für Debugzwecke enthalten.
- Static-Serving im Server ergänzen:

```ts
const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../public/packs');
app.use('/packs', express.static(packsDir, { maxAge: '365d', immutable: true }));
```

## API-Design

- `POST /asset-packs/upload`
  - Auth: Session (alle User erlaubt)
  - Body: `multipart/form-data` Feld `file` (ZIP)
  - Ablauf:
    1) ZIP prüfen (Magic-Bytes), entpacken in Temp (nur `config.json` im Root und `assets/**` zulassen; keine Symlinks/Traversal).
    2) `config.json` laden, gegen Zod-Schema validieren (siehe unten).
    3) Alle referenzierten `dataURL` müssen innerhalb `assets/` existieren und erlaubte Endungen haben.
    4) Dateien hashen und nach `public/packs/<uuid>/...` schreiben. Vorher Zielordner rekursiv löschen.
    5) `dataURL` in den Item-Objekten auf `/packs/<uuid>/...<hash>...` umschreiben; `originalPath` optional beibehalten.
    6) DB-Operation: Upsert per `uuid`.
       - existiert `uuid`:
         - identische `version`: ersetzen (UPDATE) und Dateien neu schreiben.
         - andere `version`: Upgrade-Check (Dimensions-Stabilität, s. u.) → bei Erfolg ersetzen, sonst 409.
       - existiert nicht: INSERT.
    7) Response `{ ok: true, id, uuid, version }`.
  - Fehler: 400 (ungültiges Bundle), 409 (Upgrade-Check verletzt), 500 (I/O).

- `GET /asset-packs`
  - Liefert Liste aller installierten Packs (alle Felder inkl. JSON).

- `GET /asset-packs/:id`
  - Liefert ein einzelnes Pack.

- `DELETE /asset-packs/:id`
  - Löscht Pack aus DB und leert `public/packs/<uuid>/*`.
  - Map-Referenzen: serverseitig kann eine globale Fallback-URL bereitgestellt werden (z. B. `/packs/__fallback__/missing.png`). Die tatsächliche Umschreibung der Map-Referenzen erfolgt in der Frontend-/Editor-Integration (Out-of-scope in diesem Dokument).

### Endpunkt-Skizzen (Express)

```ts
// Upload
app.post('/asset-packs/upload', upload.single('file'), async (req, res) => {
  // 1) Prüfen/entpacken → Temp
  // 2) config.json parsen/validieren (Zod)
  // 3) Assets hashen & nach public/packs/<uuid>/ schreiben (vorher löschen)
  // 4) dataURL in JSON umschreiben
  // 5) Dimensions-Check bei abweichender version; ggf. 409
  // 6) DB upsert (unique uuid)
  // 7) Return { ok: true, id, uuid, version }
});

// List
app.get('/asset-packs', async (_req, res) => {
  const list = await prisma.assetPack.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(list);
});

// Get
app.get('/asset-packs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const pack = await prisma.assetPack.findUnique({ where: { id } });
  if (!pack) return res.status(404).json({ error: 'not found' });
  res.json(pack);
});

// Delete
app.delete('/asset-packs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const pack = await prisma.assetPack.findUnique({ where: { id } });
  if (!pack) return res.status(404).json({ error: 'not found' });
  await fs.rm(path.join(packsDir, pack.uuid), { recursive: true, force: true });
  await prisma.assetPack.delete({ where: { id } });
  res.json({ ok: true });
});
```

## Validierung (Zod)

```ts
const idStr = z.string().min(1).max(200);
const relPath = z.string().min(1).regex(/^[A-Za-z0-9_\-\/\.]+$/);

const BaseItem = z.object({
  id: idStr,
  key: z.string().min(1).max(200),
  category: z.enum(['terrain', 'structure', 'objects']),
  dataURL: relPath,
  collide: z.boolean().default(false),
  placement: z.enum(['any', 'floor', 'wall']).default('any'),
  anchor: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  zIndex: z.number().int().optional(),
  rotationAllowed: z.boolean().optional(),
  flipAllowed: z.boolean().optional(),
  scaleFactor: z.number().positive().default(1),
}).strict();

const TerrainItem = BaseItem.extend({
  category: z.literal('terrain'),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  margin: z.number().int().nonnegative().default(0),
  spacing: z.number().int().nonnegative().default(0),
}).strict();

const SpriteItem = BaseItem.extend({
  category: z.enum(['structure', 'objects']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const ConfigSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  version: z.string().min(1), // optional semver-Regex
  terrain: z.array(TerrainItem).default([]),
  structures: z.array(SpriteItem).default([]),
  objects: z.array(SpriteItem).default([]),
}).strict();
```

## Upgrade-/Ersetzungsregeln

- Einzige installierte Version je `uuid`:
  - Upload gleicher `uuid@version`: ersetzen (UPDATE + Dateien neu schreiben). Optional Dimensions-Check, aber nicht zwingend.
  - Upload gleicher `uuid` mit anderer `version` (Upgrade):
    - Dimensions-Stabilität prüfen für Items mit gleicher `id`:
      - `structure/objects`: `width`/`height` müssen identisch bleiben.
      - `terrain`: `tileWidth`/`tileHeight` (und optional `margin`/`spacing`) müssen identisch bleiben.
    - Bei Abweichungen: Upload mit 409 abbrechen (kein Partial-State).
    - Bei Erfolg: DB-Datensatz ersetzen, Zielordner vollständig überschreiben.

- Deinstallation:
  - Löscht DB-Eintrag und Dateien unter `public/packs/<uuid>`.
  - Map-Referenzen werden in der Editor-/Frontend-Implementierung auf eine globale Fallback-Grafik gesetzt (Backend kann `FALLBACK_ASSET_URL` bereitstellen, z. B. `/packs/__fallback__/missing.png`).

## Sicherheit & Robustheit

- ZIP-Validierung: Magic-Bytes, Eintragsanzahl-/Pfadlängen-Sanity-Checks, blockiere Symlinks und `..`/absolute Pfade.
- Pfad-Whitelist: nur `config.json` (Root) und `assets/**` akzeptieren.
- Upload-/Body-Limits: Global sind derzeit `4mb` konfiguriert; für die Upload-Route explizit höher setzen (z. B. `50mb`).
- Atomarer Replace: Erst vollständige Verarbeitung in Temp, dann Zielordner löschen und neu schreiben.
- Logging: Upload-Größe, Anzahl Assets, Hash-Zeit, Validierungsfehler; keine geheimen Pfade oder Inhalte loggen.

## Konfiguration

- `ASSET_PACKS_DIR` (optional): Speicherort der Packs (Default: `apps/server/public/packs`).
- `FALLBACK_ASSET_URL` (optional): Fallback-Bild für deinstallierte/fehlende Assets (Default: `/packs/__fallback__/missing.png`).

## Implementierungsschritte (Backend)

1) Prisma-Modell `AssetPack` ergänzen und Migration ausführen.
2) Static-Serving `/packs` konfigurieren.
3) Upload-Route: ZIP-Parsing, Zod-Validierung, Hashing, Umschreiben, DB-Upsert, Fehlercodes.
4) GET-/DELETE-Endpunkte implementieren.
5) Upload-Limits für diese Route erhöhen.
6) Manuelle Tests: Upload eines Minimal-Packs, List/Get/Delete.

## Out of Scope (separate Spez.)

- Frontend-/Editor-Integration: Laden/Registrieren von Tilesets/Objekten, Map-Referenzen (Item-IDs statt roher URLs), UI für Pack-Management, Fallback-Umschreibung in Maps.


