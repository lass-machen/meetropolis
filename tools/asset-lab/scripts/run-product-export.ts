import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });
try {
  await server.ssrLoadModule('/scripts/export-product-assets.ts');
} finally {
  await server.close();
}
