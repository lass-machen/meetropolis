import { checkSpriteCatalog, writeSpriteCatalog } from './sprite-catalog.ts';

if (process.argv.includes('--check')) await checkSpriteCatalog();
else await writeSpriteCatalog();
