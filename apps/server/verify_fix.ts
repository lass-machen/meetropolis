
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { tileRefIdFrom } from './src/mapEncoding';

const prisma = new PrismaClient();
const JWT_SECRET = 'repro123';

async function main() {
    console.log('Verifying tileRefId offset fix...');

    // 1. Setup Dummy User/Tenant (Mocking auth)
    const userId = 'verify-user';
    const tenantId = 'verify-tenant';
    const token = jwt.sign({ sub: userId, tid: tenantId }, JWT_SECRET, { expiresIn: '1h' });

    const mapName = 'verify-map';
    const layerName = 'ground';

    // 2. Simulate Paint Request for Slot 0, Index 0
    // In the frontend, this is now calculated as: (((0 & 0xffff) << 16) | (0 & 0xffff)) + 1 = 1
    // We will send this ID to the server and check if it persists as 1.
    const tileRefId = 1;

    console.log(`Painting tileRefId: ${tileRefId} (Slot 0, Index 0 + offset)...`);

    const res = await fetch(`http://localhost:2567/maps/${mapName}/paint-rect`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            layer: layerName,
            rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
            tileRefId: tileRefId,
            erase: false
        })
    });

    if (!res.ok) {
        const txt = await res.text();
        // If we get "tenant_resolution_failed", it means the server is reachable and tried to process.
        // Since we can't easily mock the DB tenant resolution without a real DB, 
        // we will check if the server *logic* for encoding is correct by importing the function directly.
        console.log('Server response:', res.status, txt);
    }

    // Direct Logic Verification
    // We can't fully test the API end-to-end without a running DB with valid tenant.
    // But we can verify the shared code `mapEncoding.ts` which we modified.

    console.log('Verifying mapEncoding.ts logic directly...');
    const encoded = tileRefIdFrom(0, 0);
    console.log(`tileRefIdFrom(0, 0) = ${encoded}`);

    if (encoded === 1) {
        console.log('SUCCESS: tileRefIdFrom(0, 0) correctly returns 1.');
    } else {
        console.error(`FAILURE: tileRefIdFrom(0, 0) returned ${encoded}, expected 1.`);
        process.exit(1);
    }
}

main();
