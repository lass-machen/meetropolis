// Share the existing signatures between streaming limits and media handlers.

const MAGIC_BYTES: ReadonlyArray<{ bytes: number[]; mime: string }> = [
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'audio/wav' }, // RIFF (WAV)
  { bytes: [0xff, 0xfb], mime: 'audio/mpeg' }, // MP3 frame sync
  { bytes: [0xff, 0xf3], mime: 'audio/mpeg' },
  { bytes: [0xff, 0xf2], mime: 'audio/mpeg' },
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // ID3 tag
  { bytes: [0x4f, 0x67, 0x67, 0x53], mime: 'audio/ogg' }, // OGG
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], mime: 'video/webm' }, // WebM/MKV
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4' }, // MP4 (ftyp follows)
];

export function detectMimeFromMagic(buf: Buffer): string | null {
  for (const { bytes, mime } of MAGIC_BYTES) {
    if (bytes.every((b, i) => buf[i] === b)) return mime;
  }
  return null;
}
