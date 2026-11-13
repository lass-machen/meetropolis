# Stilrichtung Pixelatelier — Entwurfsvorschlag

Entwurf für ruhige Avatar-Figuren im virtuellen Büro. Reiner statischer
Entwurf: Der produktive Katalog (`packages/shared/sprite/catalog.json`) und
die Produkt-Sprites bleiben unverändert.

## Bauen

Vom Worktree-Root:

```sh
node --experimental-strip-types tools/asset-lab/style-study/generate.ts --preview-dir /tmp/meetropolis-style-preview
```

`--preview-dir` zeigt auf einen beliebigen lokalen Zielordner. Der Befehl
schreibt nur `style.html` und `out/style/*.png` darunter. Beide bleiben
lokal (gitignored) und werden nie committet. Der Befehl prüft beim Bau
die Abnahme: 4 Figuren × 4 Ansichten, 32×32-Raster, gültige Palette und
Symbole, deckende Pixel nur in y4…y29, echte Oberkante y4, getrennte
Sohlen vorne/hinten, Bodenpixel in y29, keine abgeschnittenen Pixel, dazu
die Standlinie im Maßstabsstreifen ohne Lücke. Bei Fehlern endet er mit
Exit-Code 1.

Voraussetzung ist nur Node 24.9. `pngjs` und `tsx` kommen aus bereits
vorhandenen `node_modules`, es wird nichts installiert: Der Generator
löst `tsx` relativ zur Skript- und Repo-Struktur auf (erst
`tools/asset-lab/style-study/node_modules/.bin/tsx` über den dokumentierten
gitignored Symlink, dann `node_modules/.bin/tsx` am Repo-Root, sonst `tsx`
aus PATH). `tsx` rendert nur die Vorher-Frames mit dem unveränderten
Shared-Composer; alle Prüfung und alle Nachher-Raster laufen unter plain
Node.

## Richtung

- Produkt: Stilentscheidung für Avatare im virtuellen Büro.
- Charakter: ruhig, liebevoll, leicht verspielt.
- Welt: Pixelatelier — warmes Papier, ruhige Flächen, Handwerk am Raster.
- Momente: die Figuren selbst und ihr Maßstab neben echten Möbeln.
- Signatur: die feste Standlinie im Maßstabsstreifen.

## Rezepte

Vier feste Rezepte, alle mit Hose, Kapuzenpulli blau, dunkler Hose,
braunen Schuhen und ruhigem Gesicht:

1. Figur 1: helle Haut, Seitenscheitel, braun
2. Figur 2: mittlere Haut, Bob, rot
3. Figur 3: getönte Haut (tan), Locken, schwarz
4. Figur 4: dunkle Haut, Pferdeschwanz, schwarz

Jede Figur liegt in vorne, links, rechts und hinten vor, jeweils vorher
und nachher.

## Vorher und Nachher

Vorher (`before.ts`): echte Geometrie aus dem Shared-Composer des
unveränderten Katalogs (statische Idle-Startframes aus Spalte 0,
Zeilen 0…3). Keine Python-Altgraphik.

Nachher (`grids/` + `figures.ts`): neue handgesetzte Quellraster aus
Körper (`body.ts`), Gesicht (`face.ts`) und vier neuen Frisur-Rastern
(`hair-*.ts`). Die Rastersyntax nutzt einzelne Buchstabensymbole, die
`palette.ts` Farben zuordnet.

Gestaltung: 32×32-Canvas, Figur in y4…y29, Bodenlinie y30, Mitte x15.5.
Wenig massive Kontur, lesbarer kurzer Körper, 2px hohe dunkle Augen,
kleiner Mund, kleine Profilnasen, hinten keine Gesichtspixel. Eine
Lichtquelle von links oben, auch im rechten Profil. Drei abgestimmte
Werte je Material, zusammenhängende Flächen, kein Dithering.

## Farbreihe und Maßstab

Die acht Hauttöne stammen aus der lokalen Vorschau
`knowledge/quality/asset/preview` (Datei `build.ts`, `SKIN_TONES`):
hell, mittel, getönt und dunkel als Bestandstöne an den Figuren; fair,
oliv, tief und tiefst nur als Farbreihe.

Der Maßstabsstreifen zeigt 16px-Weltraster, Figur und zwei unveränderte
Bestandsmöbel (Schreibtisch 64×48, Stuhl 24×32, beide Thema Holz aus
`tools/asset-lab/src/assets.ts`). Es gilt 1 Spritepixel = 1 Weltpixel.
