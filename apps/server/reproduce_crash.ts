
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:2567';
const JWT_SECRET = 'repro123';

async function main() {
    // 1. Setup User & Tenant (Skipped to test server stability even if DB is flaky)
    console.log('Skipping DB setup, using dummy IDs...');
    const email = `crash_test_${Date.now()}@example.com`;
    const tenantSlug = `test-tenant-${Date.now()}`;

    // Dummy IDs
    const userId = 'dummy-user-id';
    const tenantId = 'dummy-tenant-id';

    /*
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Tenant',
        slug: tenantSlug,
      }
    });
    
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Crash Test Dummy',
      }
    });
    
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: 'owner'
      }
    });
    */

    const token = jwt.sign({ sub: userId, tid: tenantId }, JWT_SECRET, { expiresIn: '1h' });
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    // 2. Paint something (PATCH /maps/office/paint-rect)
    console.log('Painting...');
    const paintRes = await fetch(`${BASE_URL}/maps/office/paint-rect`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            layer: 'ground',
            rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
            tileRefId: 123,
            erase: false
        })
    });

    if (!paintRes.ok) {
        console.error('Paint failed:', await paintRes.text());
        return;
    }
    console.log('Paint success:', await paintRes.json());

    // 3. Fetch State (GET /maps/office/state-v2)
    console.log('Fetching state-v2...');
    const stateRes = await fetch(`${BASE_URL}/maps/office/state-v2`, { headers });
    if (!stateRes.ok) {
        console.error('State fetch failed:', stateRes.status, await stateRes.text());
        return;
    }
    const state = await stateRes.json();
    console.log('State fetched. Layers:', Object.keys(state.layerIndex));

    // 4. Fetch Chunks (GET /maps/office/chunks)
    console.log('Fetching chunks...');
    // Get keys for 'ground' layer
    const layerInfo = state.layerIndex['ground'];
    if (!layerInfo || !layerInfo.keys.length) {
        console.log('No chunks found for ground layer?');
        return;
    }

    const keys = layerInfo.keys.join(',');
    const chunksRes = await fetch(`${BASE_URL}/maps/office/chunks?layer=ground&keys=${encodeURIComponent(keys)}`, { headers });

    if (!chunksRes.ok) {
        console.error('Chunks fetch failed:', chunksRes.status, await chunksRes.text());
    } else {
        console.log('Chunks fetched successfully.');
    }
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
