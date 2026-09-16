import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  characterSheet,
  defaultCharacter,
  hairNames,
  proportions,
  parseCharacter,
  type ProportionId,
} from '../src/avatar.ts';
import { newDraft, parseDraft } from '../src/draft.ts';

const hash = (data: Uint8ClampedArray): string => createHash('sha256').update(data).digest('hex');

describe('Eigenständige Avatar-Stilproben', () => {
  it('unterscheidet alle sieben produktiven Grundkörper', () => {
    const shapes = Object.keys(proportions) as ProportionId[];
    const sheets = shapes.map((proportion) => characterSheet({ ...defaultCharacter, hair: 'bald', proportion }));
    expect(new Set(sheets.map((sheet) => hash(sheet.data))).size).toBe(shapes.length);
    expect(newDraft().character.proportion).toBe('kompakt');
  });

  for (const proportion of Object.keys(proportions) as ProportionId[]) {
    it(`${proportion}: alle Frisuren und Hüte bleiben im Sheet und ergeben vier Laufrichtungen`, () => {
      for (const hair of Object.keys(hairNames))
        for (const hat of [null, 'cap', 'cowboy', 'zylinder', 'krone', 'diadem', 'hood']) {
          const config = parseCharacter({
            ...defaultCharacter,
            proportion,
            hair,
            hat,
          });
          const sheet = characterSheet(config);
          expect([sheet.width, sheet.height]).toEqual([128, 256]);
          for (let row = 0; row < 8; row++)
            for (let col = 0; col < 4; col++) {
              let visible = 0;
              let invalidAlpha = 0;
              let clippedEdges = 0;
              for (let y = 0; y < 32; y++)
                for (let x = 0; x < 32; x++) {
                  const alpha = sheet.data[((row * 32 + y) * 128 + col * 32 + x) * 4 + 3];
                  if (alpha !== 0 && alpha !== 255) invalidAlpha++;
                  if (alpha) visible++;
                  if ((x === 0 || x === 31) && alpha) clippedEdges++;
                }
              expect(invalidAlpha).toBe(0);
              expect(clippedEdges).toBe(0);
              expect(visible > 0).toBe(row >= 4 || col === 0);
            }
        }
    });

    it(`${proportion}: Gesichter, Hautfarben und Kleidungsformen bleiben unterscheidbar`, () => {
      for (const skin of ['light', 'medium', 'tan', 'dark']) {
        const hashes = ['ruhig', 'freundlich', 'wach'].map((face) =>
          hash(
            characterSheet(
              parseCharacter({
                ...defaultCharacter,
                proportion,
                skin,
                face,
                hair: 'bald',
              }),
            ).data,
          ),
        );
        expect(new Set(hashes).size).toBe(3);
      }
      const modes = [
        { outfit: 'trousers', top: 'hoodie_blue' },
        { outfit: 'dress', top: 'dress_red' },
        { outfit: 'base', top: null },
      ];
      const modeHashes = modes.map((mode) =>
        hash(characterSheet(parseCharacter({ ...defaultCharacter, proportion, ...mode })).data),
      );
      expect(new Set(modeHashes).size).toBe(3);
      const base = hash(characterSheet({ ...defaultCharacter, proportion }).data);
      for (const beard of ['schnauzer', 'vollbart', 'ziegenbart'])
        for (const glasses of ['round', 'rect', 'prof'])
          expect(
            hash(
              characterSheet({
                ...defaultCharacter,
                proportion,
                beard,
                glasses,
              }).data,
            ),
          ).not.toBe(base);
    });

    it(`${proportion}: Kapuze ersetzt jede Frisur identisch`, () => {
      const sheets = Object.keys(hairNames).map((hair) =>
        hash(characterSheet({ ...defaultCharacter, proportion, hair, hat: 'hood' }).data),
      );
      expect(new Set(sheets).size).toBe(1);
    });
  }

  it('speichert die ausgewählte Form; Rezepte ohne Form werden kompakt', () => {
    const old = newDraft();
    old.character = { ...defaultCharacter };
    delete old.character.proportion;
    const restoredOld = parseDraft(JSON.stringify(old));
    expect(restoredOld.character.proportion).toBe('kompakt');
    expect(hash(characterSheet(restoredOld.character).data)).toBe(hash(characterSheet(defaultCharacter).data));
    const draft = newDraft();
    draft.character.proportion = 'schlank';
    const restored = parseDraft(JSON.stringify(draft));
    expect(restored.character.proportion).toBe('schlank');
    expect(hash(characterSheet(restored.character).data)).toBe(hash(characterSheet(draft.character).data));
    for (const proportion of ['unbekannt', '__proto__', null])
      expect(() => parseCharacter({ ...defaultCharacter, proportion })).toThrow();
  });
});
