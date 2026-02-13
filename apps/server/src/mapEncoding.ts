export type RlePair = [number, number];

export function rleEncodeNumbers(values: number[]): RlePair[] {
  const out: RlePair[] = [];
  if (values.length === 0) return out;
  let current = values[0];
  let count = 1;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v === current) {
      count++;
    } else {
      out.push([current, count]);
      current = v;
      count = 1;
    }
  }
  out.push([current, count]);
  return out;
}

export function rleEncodeBooleans(values: boolean[]): RlePair[] {
  const nums = values.map((b) => (b ? 1 : 0));
  return rleEncodeNumbers(nums);
}

export function encodeRlePairsToBuffer(pairs: RlePair[]): Buffer {
  // Store as compact JSON for now; gzip handled by HTTP compression.
  const json = JSON.stringify(pairs);
  return Buffer.from(json, 'utf8');
}

export function decodeRlePairsFromBuffer(buf: Buffer): RlePair[] {
  if (!buf || buf.length === 0) return [];
  try {
    const s = buf.toString('utf8');
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr as RlePair[];
  } catch { }
  return [];
}

export function rleDecodeToNumbers(pairs: RlePair[], total: number): number[] {
  const out: number[] = new Array(total);
  let i = 0;
  for (const [val, count] of pairs) {
    for (let c = 0; c < count && i < total; c++) {
      out[i++] = val;
    }
    if (i >= total) break;
  }
  while (i < total) out[i++] = 0;
  return out;
}

export function rleDecodeToBooleans(pairs: RlePair[], total: number): boolean[] {
  return rleDecodeToNumbers(pairs, total).map(v => v !== 0);
}

export function tileRefIdFrom(slot: number, tileIndex: number): number {
  // Offset by 1 to ensure 0 is reserved for "empty"
  return (((slot & 0xffff) << 16) | (tileIndex & 0xffff)) + 1;
}

export function splitTileRefId(id: number): { slot: number; tileIndex: number } {
  const raw = id - 1;
  const slot = (raw >>> 16) & 0xffff;
  const tileIndex = raw & 0xffff;
  return { slot, tileIndex };
}

export function chunkIndex(x: number, y: number, chunkSize: number): number {
  return y * chunkSize + x;
}


