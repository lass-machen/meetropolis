import { describe, expect, it } from 'vitest';
import { Pixels } from '../src/pixels.ts';

describe('Rasterkomposition', () => {
  it('beschneidet Rechtecke an allen Bildrändern', () => {
    const image = new Pixels(3, 2);
    image.rect(-1, -1, 3, 3, '#123456');
    expect([...image.data]).toEqual([
      18, 52, 86, 255, 18, 52, 86, 255, 0, 0, 0, 0, 18, 52, 86, 255, 18, 52, 86, 255, 0, 0, 0, 0,
    ]);
    image.rect(2, 1, 9, 9, '#abcdef');
    expect([...image.data.slice(-4)]).toEqual([171, 205, 239, 255]);
  });

  it('erhält transparente Bereiche und beschneidet verschobene Bilder', () => {
    const source = new Pixels(3, 2);
    source.rect(1, 0, 2, 1, '#123456');
    source.rect(0, 1, 2, 1, '#abcdef');
    const image = new Pixels(2, 2);
    image.rect(0, 0, 2, 2, '#ffffff');
    image.stamp(source, -1, 0);
    expect([...image.data]).toEqual([18, 52, 86, 255, 18, 52, 86, 255, 171, 205, 239, 255, 255, 255, 255, 255]);
    image.stamp(source, 1, -1);
    expect([...image.data.slice(4, 8)]).toEqual([171, 205, 239, 255]);
    const before = image.data.slice();
    image.stamp(source, -20, 0);
    image.stamp(source, 0, 20);
    expect(image.data).toEqual(before);
  });
});
