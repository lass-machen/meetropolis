export function parseMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
