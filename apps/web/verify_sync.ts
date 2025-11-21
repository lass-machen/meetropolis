
import { Client } from 'colyseus.js';
// import fetch from 'node-fetch'; // Use global fetch
import jwt from 'jsonwebtoken';

// Configuration
const API_URL = 'http://localhost:2567';
const WS_URL = 'ws://localhost:2567';
const JWT_SECRET = 'repro123';
const MAP_NAME = 'verify-map';

async function main() {
    console.log('Starting Sync Verification...');

    // 1. Setup Auth
    const userId = 'sync-user';
    const tenantId = 'verify-tenant';
    const token = jwt.sign({ sub: userId, tid: tenantId }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Connect to Colyseus
    const client = new Client(WS_URL);
    console.log('Connecting to Colyseus...');

    try {
        const room = await client.joinOrCreate('world', {
            tenant: 'default', // Assuming default tenant slug
            identity: userId,
            name: 'Sync Tester'
        });
        console.log('Joined room:', room.id);

        // 3. Listen for chunks_updated
        const updatePromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout waiting for chunks_updated')), 5000);

            room.onMessage('chunks_updated', (message) => {
                console.log('Received chunks_updated:', JSON.stringify(message, null, 2));
                if (message.map === MAP_NAME) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });

        // 4. Trigger Paint via API
        console.log('Triggering paint via API...');
        const res = await fetch(`${API_URL}/maps/${MAP_NAME}/paint-rect`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Tenant': 'default'
            },
            body: JSON.stringify({
                layer: 'ground',
                rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
                tileRefId: 1, // Valid ID
                erase: false
            })
        });

        if (!res.ok) {
            console.error('API Error:', res.status, await res.text());
        } else {
            console.log('API Request successful');
        }

        // 5. Wait for broadcast
        await updatePromise;
        console.log('SUCCESS: chunks_updated received!');

        room.leave();
        process.exit(0);

    } catch (e) {
        console.error('Verification Failed:', e);
        process.exit(1);
    }
}

main();
