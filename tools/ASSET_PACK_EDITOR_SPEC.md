## Ziel

- Externer, dokumentbasierter Editor (macOS-typisch) zum Erstellen/Bearbeiten von Asset Packs.
- Ausgabeformat: ZIP-Bundle mit der Endung `.mepack` (intern normales ZIP) und optional „Speichern unter…“ als `.zip`.
- Bundles sind 1:1 kompatibel mit dem Server-Importer gemäß `ASSET_PACKS_SPEC.md`.
- Fokus: Korrekte Generierung von Struktur, `config.json` und `assets/`-Inhalten. Keine Server-Integration in diesem Dokument.

## Scope

- Dokumentmodell „Asset Pack“ inkl. Metadaten und Items (Terrain/Structures/Objects).
- Validierung beim Öffnen/Speichern, damit das erzeugte Bundle vom Server akzeptiert wird.
- Dateiverwaltung für eingebettete Bilder im `assets/`-Ordner des Bundles.
- Kein Upload, kein Backend; ausschließlich Dateiformat-Erzeugung.

## Datei-/Bundle-Format

- Container: ZIP-Archiv (Deflate). Dateiendung nativ `.mepack`; „Speichern unter…“ erlaubt `.zip`.
- Zeichensatz: UTF-8. `config.json` ohne BOM; Zeilenende `\n` (nicht strikt erforderlich, aber empfohlen).
- Ordnerstruktur (Root des ZIP):
  - `config.json` (Pflicht)
  - `assets/` (Pflicht): enthält alle referenzierten Bilddateien
- Erlaubte Bildformate: vorerst `.png`, `.webp` (klein-/großschreibung akzeptieren, auf konsistente Ausgabe achten).
- Pfadregeln:
  - Alle `dataURL` verweisen relativ auf `assets/...` (z. B. `assets/objects/chair.png`).
  - Keine absoluten Pfade, keine Traversal-Sequenzen (`..`).
  - Empfohlene Unterordner: `assets/tilesets/`, `assets/structures/`, `assets/objects/`.

## config.json: inhaltliches Schema

Die Struktur entspricht der Server-Spezifikation. Der Editor muss konsistent und valide exportieren.

- Pack-Metadaten (Pflicht):
  - `uuid` (string, UUID v4)
  - `name` (string)
  - `description` (string)
  - `author` (string)
  - `version` (string; frei, z. B. Semver)

- Items: Drei Arrays
  - `terrain`: Tileset-Definitionen (Grid-basiert)
  - `structures`: Sprite-basierte Strukturen
  - `objects`: Sprite-basierte Objekte

Gemeinsame Item-Felder (alle Kategorien):
- `id` (string; pack-intern stabil über Versionen hinweg; eindeutig innerhalb des Packs)
- `key` (string; technischer Name)
- `category`: `"terrain" | "structure" | "objects"`
- `dataURL`: Pfad relativ zu `assets/`
- `collide`: boolean
- `placement`: `"any" | "floor" | "wall"`
- `scaleFactor` (number, optional, default 1.0) — rendering scale factor
- optional: `anchor` {x:number, y:number}, `offset` {x:number, y:number}, `zIndex` (int), `rotationAllowed` (bool), `flipAllowed` (bool)

Terrain-spezifisch (`category = "terrain"`):
- `tileWidth` (int > 0), `tileHeight` (int > 0)
- `margin` (int >= 0, default 0)
- `spacing` (int >= 0, default 0)
- Bei Terrain sind `width`/`height` nicht erlaubt.

Sprite-spezifisch (`category in {"structure","objects"}`):
- `width` (int > 0), `height` (int > 0)
- Für Sprites sind `tileWidth`/`tileHeight` nicht erlaubt.

### Beispiel-`config.json`

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
      "dataURL": "assets/tilesets/office_tiles.png",
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
      "dataURL": "assets/structures/wall_gray.png",
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
      "dataURL": "assets/objects/chair_blue.png",
      "width": 16,
      "height": 16,
      "placement": "floor",
      "collide": false
    }
  ]
}
```

## Validierungsanforderungen (Client-seitig im Editor)

Der Editor muss vor dem Speichern prüfen, dass das Bundle die Server-Anforderungen erfüllt:

- `uuid` ist gültig (UUID v4). Bei „Neu“ generieren.
- Pflichtfelder der Metadaten sind gesetzt (`name`, `description`, `author`, `version`).
- Jedes Item besitzt eine eindeutige `id` und `key` innerhalb des Packs.
- `category` ist gültig und konsistent mit den Feldern:
  - Terrain: `tileWidth`, `tileHeight` vorhanden; keine `width`/`height`.
  - Sprite (structure/objects): `width`, `height` vorhanden; keine `tileWidth`/`tileHeight`.
- `dataURL` zeigt auf einen existierenden Eintrag unter `assets/` und enthält keine Traversals/absoluten Pfade.
- Dateitypen unter `assets/` sind `.png` oder `.webp`.
- `placement` ist eines von `any|floor|wall`; `collide` ist boolean.

### Dimensions-Stabilität bei Versionswechsel

Wenn eine bestehende `.mepack` geöffnet und unter neuer `version` gespeichert wird (Upgrade), dürfen sich die Dimensionen pro Item-ID nicht ändern:
- Für Sprites (`structure/objects`): `width` und `height` müssen identisch bleiben.
- Für Terrain: `tileWidth` und `tileHeight` (optional auch `margin`/`spacing`) müssen identisch bleiben.

Der Editor soll beim Speichern prüfen, ob sich bei gleicher `id` Werte geändert haben und den Nutzer mit einem Fehler abhalten.

## Anwendungs- und UI-Workflows

### Neues Asset Pack anlegen
- Dialog „Neues Asset Pack“ erzeugt Dokument mit:
  - Generierter `uuid` (v4), leeren Arrays `terrain/structures/objects`.
  - Leere Metafelder (`name`, `description`, `author`, `version`).
- Oberfläche:
  - „Paket-Informationen“: Name, Beschreibung, Autor, Version.
  - „Items“-Bereich mit Tabs: Terrain | Structures | Objects.
    - Terrain-Editor: Felder `id`, `key`, Datei wählen (legt Datei in `assets/tilesets/` ab), `tileWidth`, `tileHeight`, optional `margin`, `spacing`, `placement`, `collide`, optionale Felder.
    - Sprite-Editor: Felder `id`, `key`, Datei wählen (legt Datei in `assets/structures/` bzw. `assets/objects/` ab), `width`, `height`, `placement`, `collide`, optionale Felder.
  - Einfache Vorschau der geladenen Datei (optional).

### Öffnen
- `.mepack` laden (ZIP entpacken in Temp, `config.json` parsen, `assets/` referenzieren).
- Validierung beim Öffnen (inkonsistente Bundles früh abweisen oder als „read-only“ markieren, bis repariert).

### Speichern
- Erzeugt `.mepack` (ZIP) mit aktueller Struktur:
  - `config.json` serialisiert; `dataURL` relativ unter `assets/...` korrekt.
  - Alle referenzierten Dateien aus dem Dokument-Workspace in `assets/` schreiben.
- Keine Hash-Umbennenung durch den Editor; der Server übernimmt Hashing und Pfadumschreibung bei Installation.

### Speichern unter…
- Export als `.zip` statt `.mepack`. Inhalt identisch, nur Dateiendung anders.

### Umbenennen/Verschieben von Dateien
- Beim Austausch einer Bilddatei muss der Editor die Datei ins Dokument-`assets/` übernehmen und `dataURL` aktualisieren.
- Empfohlene Benennungen:
  - Terrain: `assets/tilesets/<name>.png`
  - Structure: `assets/structures/<name>.png`
  - Object: `assets/objects/<name>.png`
- Editor sollte Dateinamen sanitizen: ASCII, `[A-Za-z0-9._-]`, Leerzeichen durch `_` ersetzen.

## Technische Anforderungen (Implementierungsempfehlungen)

- ZIP-Erzeugung: Deflate, keine Verschlüsselung. ZIP64 nur bei sehr großen Dateien nötig.
- JSON-Serialisierung: UTF-8, deterministische Schlüsselreihenfolge nicht erforderlich, aber stabile Ausgabe erwünscht.
- Bild-Metadaten: Der Editor kann Bildbreite/-höhe ermitteln und als Hilfestellung vorschlagen; maßgeblich sind die eingegebenen Felder.
- Pfad-Sicherheit: Beim Import von externen Dateien immer in das Dokument-`assets/` kopieren und relative, sichere Pfade verwenden.

## Testfälle (manuell)

1) Minimalpaket:
   - 1 Terrain-Tileset (16x16), 1 Object (16x16)
   - `.mepack` speichern → Server-Upload akzeptiert.
2) Ungültige Pfade:
   - `dataURL` außerhalb `assets/` → Editor verhindert Speichern.
3) Falsche Felder:
   - Terrain mit `width`/`height` → Editor meldet Fehler.
4) Versions-Upgrade:
   - Bestehendes `.mepack` öffnen, `version` erhöhen, aber Item-Dimension ändern → Editor blockt Speichern.

## Beispiel: Minimaler Bundle-Inhalt

```
my-pack.mepack
├─ config.json
└─ assets/
   ├─ tilesets/
   │  └─ office_tiles.png
   └─ objects/
      └─ chair_blue.png
```

## Autotile Tab

Neben den bestehenden Tabs (Terrain | Structures | Objects) gibt es einen vierten Tab: **Autotiles**.

### Felder im Autotile-Editor

- `id` (string, Pflicht): Pack-intern stabile ID. Eindeutig innerhalb des Packs.
- `key` (string, Pflicht): Technischer Name.
- Datei wählen: Bilddatei (`.png`/`.webp`) für das Spritesheet. Wird unter `assets/autotiles/` abgelegt.
- `tileWidth` / `tileHeight` (int > 0, Pflicht): Kachelgröße in Pixeln.
- `gridHeight` (int > 0, default 1): Höhe in Grid-Zellen (für doppelt hohe Wände etc.).
- `placement`: `"wall"` (default) | `"floor"` | `"any"`.
- `collide`: boolean (default `true`).
- `autotileType`: `"4bit"` (default) | `"8bit"`. Bestimmt den Bitmask-Algorithmus.
- `scaleFactor` (number > 0, optional): Render-Skalierungsfaktor.

### Varianten-Mapping-UI

- Zeigt eine Grid-Vorschau des Spritesheets an.
- Der Nutzer kann per Klick auf eine Zelle im Grid die Zuordnung Bitmask → Position setzen.
- Alternative: Tabelle mit Bitmask-Wert (0–15 für 4bit, 0–46 für 8bit) und Spalte/Zeile im Spritesheet.
- Der Editor kann anhand von `tileWidth`/`tileHeight` und der Bildgröße die verfügbaren Positionen berechnen.

### Validierung

- `category` muss `"autotile"` sein.
- `tileWidth`, `tileHeight` und `variants` sind Pflicht.
- `variants` muss ein Objekt sein, in dem Keys gültige Bitmask-Strings und Values `{col, row}` sind.
- Alle `col`/`row`-Werte müssen innerhalb der berechneten Spritesheet-Grenzen liegen.
- Bei Versionswechsel: `tileWidth`/`tileHeight` müssen bei gleicher `id` stabil bleiben.
- Empfohlener Unterordner: `assets/autotiles/`.

### Beispiel-Bundle mit Autotile

```
my-pack.mepack
├─ config.json
└─ assets/
   ├─ tilesets/
   │  └─ office_tiles.png
   ├─ objects/
   │  └─ chair_blue.png
   └─ autotiles/
      └─ wall_gray.png
```

## Abgrenzung zu Server-Verhalten

- Der Server rewritet `dataURL` auf gehashte Dateinamen und speichert Inhalte unter `/packs/<uuid>/...`.
- Der Editor darf keine Hashes vergeben und keine Server-spezifischen Pfade schreiben.
- Einzigartigkeit von `uuid` pro Installation erzwingt der Server; der Editor sorgt nur für gültige Formate.


