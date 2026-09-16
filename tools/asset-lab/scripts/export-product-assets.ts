import { checkProductAssets, exportProductAssets } from './product-assets.ts';

const check = process.argv.includes('--check');
const files = check ? await checkProductAssets() : await exportProductAssets();
const bytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
console.log(`${check ? 'Verified' : 'Exported'} ${files.length} product artifacts (${bytes} bytes).`);
