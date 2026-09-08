import { describe, expect, it } from 'vitest';
import {
  characterSheet,
  defaultCharacter,
  proportions,
  extraHatNames,
  extraBeardNames,
  type ProportionId,
} from '../src/avatar.ts';

const bodies = [undefined, ...Object.keys(proportions)] as (ProportionId | undefined)[];
const rgba = (data: Uint8ClampedArray, x: number, y: number) =>
  [...data.slice((y * 128 + x) * 4, (y * 128 + x + 1) * 4)].join(',');

describe('Zubehör folgt der tatsächlich ausgewählten Kopfgeometrie', () => {
  it('Hüte berühren den Kopf und erhalten die Augen in jeder Richtung und Laufphase', () => {
    for (const proportion of bodies) {
      const config = {
        ...defaultCharacter,
        proportion,
        hair: 'bald',
        face: 'wach' as const,
      };
      const base = characterSheet(config);
      const eyes = proportion?.startsWith('kompakt')
        ? ['53,44,67,255', '255,240,220,255']
        : ['46,34,47,255', '255,255,255,255'];
      const mouthY = proportion ? proportions[proportion].headY + proportions[proportion].headHeight - 2 : 16;
      for (const hat of Object.keys(extraHatNames)) {
        const sheet = characterSheet({ ...config, hat });
        let checkedEyes = 0;
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 128; x++) {
            const before = rgba(base.data, x, y);
            // Die Lichtpunkte identifizieren echte Augen, auch wenn Kontur und Pupille dieselbe Farbe nutzen.
            if (before === eyes[1]) {
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  const eye = rgba(base.data, x + dx, y + dy);
                  if (eyes.includes(eye)) {
                    expect(rgba(sheet.data, x + dx, y + dy), `${proportion}/${hat}: Auge ${x + dx},${y + dy}`).toBe(
                      eye,
                    );
                    checkedEyes++;
                  }
                }
            }
          }
        expect(checkedEyes).toBeGreaterThan(20);
        for (let row = 0; row < 4; row++) {
          let headContact = 0;
          for (let y = 0; y < mouthY; y++)
            for (let x = 0; x < 32; x++) {
              const yy = row * 32 + y;
              if (base.data[(yy * 128 + x) * 4 + 3] && rgba(base.data, x, yy) !== rgba(sheet.data, x, yy))
                headContact++;
            }
          expect(headContact, `${proportion}/${hat}: Kopfkontakt Richtung ${row}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('kurze Bärte bleiben am Kinn, lange Bärte beginnen am Mund statt auf der Kleidung', () => {
    for (const proportion of bodies) {
      const config = { ...defaultCharacter, proportion, hair: 'bald' };
      const base = characterSheet(config);
      const mouthY = proportion ? proportions[proportion].headY + proportions[proportion].headHeight - 2 : 16;
      for (const beard of Object.keys(extraBeardNames)) {
        const sheet = characterSheet({ ...config, beard });
        for (const row of [0, 1, 2]) {
          const changedRows: number[] = [];
          for (let y = 0; y < 32; y++)
            for (let x = 0; x < 32; x++)
              if (rgba(base.data, x, row * 32 + y) !== rgba(sheet.data, x, row * 32 + y)) changedRows.push(y);
          expect(Math.min(...changedRows), `${proportion}/${beard}: Bartansatz Richtung ${row}`).toBe(mouthY - 1);
          expect(Math.max(...changedRows)).toBeLessThanOrEqual(mouthY + (beard === 'long_beard' ? 7 : 2));
        }
      }
    }
  });

  it('alle Bärte erhalten den vollständigen Mund bei jedem Gesicht und jeder Animation', () => {
    for (const proportion of bodies)
      for (const face of ['ruhig', 'freundlich', 'wach'] as const) {
        const config = { ...defaultCharacter, proportion, face, hair: 'bald' };
        const base = characterSheet(config);
        const mouthColor = proportion?.startsWith('kompakt') ? '179,109,105,255' : '193,122,94,255';
        for (const beard of Object.keys(extraBeardNames)) {
          const sheet = characterSheet({ ...config, beard });
          let checkedMouth = 0;
          for (let y = 0; y < 256; y++)
            for (let x = 0; x < 128; x++)
              if (rgba(base.data, x, y) === mouthColor) {
                expect(rgba(sheet.data, x, y), `${proportion}/${beard}/${face}: Mund ${x},${y}`).toBe(mouthColor);
                checkedMouth++;
              }
          expect(checkedMouth).toBeGreaterThan(10);
        }
      }
  });
});
