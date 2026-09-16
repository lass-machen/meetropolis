# Avatar-Katalog v6

Der Wechsel auf v6 ist ein atomarer Schnitt. Shared-Paket, Server und Web-Editor müssen gemeinsam ausgerollt werden: Der Server akzeptiert und hasht `face` und `proportion`, während der Editor genau dieselben Felder aus dem gemeinsamen Katalog rendert. Ein gemischter Stand könnte korrekte Rezepte mit einer falschen Identität oder Vorschau speichern.

## Gemeinsame Rasterquelle

Die Pixelraster bleiben unter `tools/asset-lab/src/` die einzige bearbeitbare Quelle. `npm run catalog:build` im Verzeichnis `tools/asset-lab` erzeugt daraus `packages/shared/sprite/catalog.json`. Der Katalog enthält die sieben Körperformen, drei Gesichter, sechs zusätzlichen Hüte, vier zusätzlichen Bärte und die rote Bartpalette als Daten-Overlays. Atelier, Web und Server interpretieren danach dasselbe Artefakt; keiner dieser Verbraucher baut die Raster zur Laufzeit erneut auf.

`npm run catalog:check` erzeugt den Katalog im Speicher erneut und bricht bei jeder Abweichung ab. Der Check ist auch Teil von `npm run assets:check`.

## Bestehende Custom Avatars

Alte Rezepte werden mit `proportion=kompakt` und `face=ruhig` kanonisiert. Die Datenbankmigration erfolgt bewusst erst nach dem Deploy und ist standardmäßig schreibgeschützt:

```bash
npm -w @meetropolis/server run avatar:rerender
```

Nach Prüfung der Dry-run-Ausgabe wird dieselbe Version einmal mit Schreibfreigabe ausgeführt:

```bash
npm -w @meetropolis/server run avatar:rerender -- --apply
```

Das Skript ist idempotent. Es überspringt Zeilen mit aktuellem Katalog- und Rendererhash, erzeugt andernfalls eine neue UUID und aktualisiert Rezept, URLs, Hash und `User.avatarId` gemeinsam. Alte PNG-Dateien werden nicht gelöscht.

## Identität und Manifeste

Die Renderidentität umfasst die kanonische Konfiguration, das Katalogschema und die Rendererversion. Dadurch kann ein Rezept nach einem Katalogwechsel keine Datei der vorherigen Generation wiederverwenden. Die Frame-Geometrie eines vorhandenen Custom Avatars wird aus seinem gespeicherten PNG gelesen und nicht aus dem aktuell geladenen Katalog abgeleitet.
