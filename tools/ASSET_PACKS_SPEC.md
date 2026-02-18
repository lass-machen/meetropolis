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

### Directional Images (nur Objects)

Objects können optionale richtungsspezifische Bilder für Rotationswinkel bereitstellen:

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `directionalImages` | Array | nein | Bis zu 4 Bilder für Rotationen |
| `directionalImages[].rotation` | `0\|90\|180\|270` | ja | Rotationswinkel in Grad |
| `directionalImages[].dataURL` | string | ja | Pfad relativ zu `assets/` |

Wenn ein Object mit `rotationAllowed: true` und einer bestimmten `rotation` platziert wird,
verwendet der Renderer das passende `directionalImages`-Bild. Fehlt ein Eintrag für die
aktuelle Rotation, wird das Standardbild (`dataURL`) programmatisch rotiert.

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
      "collide": false,
      "rotationAllowed": true,
      "directionalImages": [
        { "rotation": 0, "dataURL": "assets/objects/chair_blue_0.png" },
        { "rotation": 90, "dataURL": "assets/objects/chair_blue_90.png" },
        { "rotation": 180, "dataURL": "assets/objects/chair_blue_180.png" },
        { "rotation": 270, "dataURL": "assets/objects/chair_blue_270.png" }
      ]
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

const DirectionalImage = z.object({
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  dataURL: relPath,
}).strict();

const SpriteItem = BaseItem.extend({
  category: z.enum(['structure', 'objects']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  directionalImages: z.array(DirectionalImage).max(4).optional(),
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

## Autotile Items

Neben `terrain`, `structures` und `objects` unterstützt `config.json` ein viertes Array: `autotiles`.

Autotile-Items beschreiben Spritesheet-basierte Kacheln, die sich automatisch an ihre Nachbarn anpassen (z. B. Wände, die je nach Umgebung verschiedene Varianten wählen).

### Felder

| Feld | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `id` | string | ja | – | Pack-intern stabile ID |
| `key` | string | ja | – | Technischer Name |
| `category` | `"autotile"` | ja | – | Feste Kategorie |
| `dataURL` | string | ja | – | Pfad relativ zu `assets/` (`.png`/`.webp`) |
| `placement` | `"wall"\|"floor"\|"any"` | nein | `"wall"` | Platzierungstyp |
| `collide` | boolean | nein | `true` | Kollision aktiv |
| `tileWidth` | int > 0 | ja | – | Breite einer Kachel in Pixeln |
| `tileHeight` | int > 0 | ja | – | Höhe einer Kachel in Pixeln |
| `gridHeight` | int > 0 | nein | `1` | Höhe in Grid-Zellen (z. B. 2 für doppelt hohe Wände) |
| `autotileType` | `"4bit"\|"8bit"` | nein | `"4bit"` | Bitmask-Algorithmus (4bit=16 Varianten, 8bit=47 Varianten) |
| `variants` | Record<string, {col, row}> | ja | – | Bitmask → Spritesheet-Position |
| `scaleFactor` | number > 0 | nein | – | Optionaler Render-Skalierungsfaktor |

### Bitmask-Varianten-Mapping

Das `variants`-Objekt mappt Bitmask-Werte (als String-Keys, z. B. `"0"`, `"5"`, `"15"`) auf Positionen im Spritesheet:

```json
{
  "0": { "col": 0, "row": 0 },
  "1": { "col": 1, "row": 0 },
  "5": { "col": 2, "row": 0 },
  "15": { "col": 3, "row": 0 }
}
```

Bei **4bit** werden die 4 direkten Nachbarn (N, E, S, W) mit Bits 1, 2, 4, 8 kodiert → bis zu 16 Varianten.
Bei **8bit** werden zusätzlich die Diagonalen berücksichtigt → bis zu 47 effektive Varianten (nach Reduktion).

### Dimensions-Stabilität

Bei Versionsupgrade eines Packs müssen `tileWidth` und `tileHeight` von Autotile-Items mit gleicher `id` stabil bleiben. Änderungen führen zu HTTP 409 beim Upload.

### Beispiel config.json (Auszug)

```json
{
  "autotiles": [
    {
      "id": "office_wall_gray",
      "key": "office_wall_gray",
      "category": "autotile",
      "dataURL": "assets/autotiles/wall_gray.png",
      "placement": "wall",
      "collide": true,
      "tileWidth": 16,
      "tileHeight": 16,
      "gridHeight": 1,
      "autotileType": "4bit",
      "variants": {
        "0":  { "col": 0, "row": 0 },
        "1":  { "col": 1, "row": 0 },
        "2":  { "col": 2, "row": 0 },
        "3":  { "col": 3, "row": 0 },
        "4":  { "col": 0, "row": 1 },
        "5":  { "col": 1, "row": 1 },
        "6":  { "col": 2, "row": 1 },
        "7":  { "col": 3, "row": 1 },
        "8":  { "col": 0, "row": 2 },
        "9":  { "col": 1, "row": 2 },
        "10": { "col": 2, "row": 2 },
        "11": { "col": 3, "row": 2 },
        "12": { "col": 0, "row": 3 },
        "13": { "col": 1, "row": 3 },
        "14": { "col": 2, "row": 3 },
        "15": { "col": 3, "row": 3 }
      }
    }
  ]
}
```

### Datenbank

Die `AssetPack`-Tabelle enthält eine zusätzliche JSON-Spalte `autotiles` (Default: `[]`). Autotile-Items werden wie Terrain/Structures/Objects behandelt: `dataURL` wird beim Upload auf gehashte Pfade umgeschrieben und in der DB gespeichert.

## Out of Scope (separate Spez.)

- Frontend-/Editor-Integration: Laden/Registrieren von Tilesets/Objekten, Map-Referenzen (Item-IDs statt roher URLs), UI für Pack-Management, Fallback-Umschreibung in Maps.


