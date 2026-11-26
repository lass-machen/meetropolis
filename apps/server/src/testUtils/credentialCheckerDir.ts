import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// The entrypoint only runs a compiled checker, so tests compile the real
// source instead of relying on a prior build.
export function prepareCredentialCheckerDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-checker-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sources = ['startupCredentials.ts', 'credentialPolicy.ts'];
  const outDir = path.join(dir, 'dist', 'ops');
  fs.mkdirSync(outDir, { recursive: true });
  for (const source of sources) {
    const input = fs.readFileSync(path.join(here, '..', 'ops', source), 'utf8');
    const output = transpileModule(input, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    fs.writeFileSync(path.join(outDir, source.replace(/\.ts$/, '.js')), output);
  }
  return dir;
}
