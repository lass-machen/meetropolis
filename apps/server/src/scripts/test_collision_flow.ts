
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const PORT = 2568;
const BASE_URL = `http://localhost:${PORT}`;
const PEPPER = 'dev';

async function main() {
  // 1. Setup User & Token
  const userEmail = `tester-${Date.now()}@test.com`;
  const user = await prisma.user.create({
    data: { email: userEmail, name: 'Tester', emailVerifiedAt: new Date() }
  });

  const tokenRaw = 'test-token-' + Date.now();
  const hash = createHash('sha256').update(PEPPER + tokenRaw).digest('hex');
  await prisma.apiToken.create({
    data: { userId: user.id, hash, name: 'Test Token' }
  });

  console.log(`Created user ${user.id} and token`);

  // 2. Send Paint Request
  const payload = {
    layer: 'collision',
    rect: { x0: 0, y0: 0, x1: 32, y1: 32 }, // One chunk of 32x32
    tileRefId: 1, // 1 = solid
    erase: false
  };

  console.log('Sending paint request...');
  const res = await fetch(`${BASE_URL}/maps/office/paint-rect`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenRaw}`,
      'Content-Type': 'application/json',
      'X-Tenant': 'default'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    console.error('Paint failed:', res.status, await res.text());
    process.exit(1);
  }

  const json: any = await res.json();
  console.log('Paint success:', JSON.stringify(json, null, 2));

  // 3. Verify DB
  const map = await prisma.map.findFirst({ where: { name: 'office' } });
  if (!map) throw new Error('Map office not found');

  const layer = await prisma.mapLayer.findFirst({ where: { mapId: map.id, name: 'collision' } });
  
  if (!layer) {
    console.error('Layer NOT created in DB!');
    process.exit(1);
  }
  
  const chunk = await prisma.mapChunk.findFirst({ where: { layerId: layer.id, x: 0, y: 0 } });
  if (!chunk) {
    console.error('Chunk NOT created in DB!');
    process.exit(1);
  }

  console.log(`Chunk found: ver=${chunk.version}, len=${chunk.data.length}`);

  // 4. Fetch Chunks (Read-back)
  console.log('Fetching chunks back...');
  const chunksRes = await fetch(`${BASE_URL}/maps/office/chunks?layer=collision&keys=0:0`, {
     headers: { 'X-Tenant': 'default' }
  });
  
  if (!chunksRes.ok) {
    console.error('Fetch chunks failed:', chunksRes.status);
    process.exit(1);
  }
  
  const chunksJson: any = await chunksRes.json();
  console.log('Chunks response:', JSON.stringify(chunksJson, null, 2));
  
  if (!chunksJson.chunks || !chunksJson.chunks['0:0']) {
     console.error('Chunk missing in API response');
     process.exit(1);
  }

  console.log('SUCCESS: Round-trip test passed.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

