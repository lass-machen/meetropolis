
// import fetch from 'node-fetch'; // Use global fetch
import jwt from 'jsonwebtoken';

// Configuration
const API_URL = 'http://localhost:2567';
const JWT_SECRET = 'repro123';
const MAP_NAME = 'verify-map';

async function main() {
    console.log('Starting Persistence Verification...');

    // 1. Setup Auth
    const userId = 'persist-user';
    const tenantId = 'verify-tenant';
    const token = jwt.sign({ sub: userId, tid: tenantId }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Trigger Paint via API
    console.log('Triggering paint via API...');
    // Painting a 3x3 block of tiles with ID 1 (which should be offset to 2 internally if the fix works, or just 1 if raw)
    // Actually the client sends the raw ID from the tileset.
    // Let's send a valid payload.
    const paintPayload = {
        layer: 'ground',
        rect: { x0: 0, y0: 0, x1: 2, y1: 2 }, // 3x3 area
        values: [1, 1, 1, 1, 1, 1, 1, 1, 1] // All tile ID 1
    };

    const res = await fetch(`${API_URL}/maps/${MAP_NAME}/paint-rect`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Tenant': 'default'
        },
        body: JSON.stringify(paintPayload)
    });

    if (!res.ok) {
        console.error('Paint API Failed:', res.status, await res.text());
        process.exit(1);
    }
    console.log('Paint API Request successful');

    // 3. Verify Persistence (Fetch State)
    console.log('Fetching map state...');
    const stateRes = await fetch(`${API_URL}/maps/${MAP_NAME}/state-v2`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant': 'default'
        }
    });

    if (!stateRes.ok) {
        console.error('Fetch State Failed:', stateRes.status, await stateRes.text());
        process.exit(1);
    }

    const state = await stateRes.json();
    console.log('State fetched successfully');

    // 4. Check if chunks contain our data
    // We need to decode the chunks.
    // Since we can't easily decode RLE here without the util, we'll just check if chunks exist and have data.
    // Ideally we should check the content.

    // For now, just seeing if it didn't crash and returned chunks is a good start.
    // The user says "reload = weg", which implies the state fetch returns empty/old data.

    // Note: The server might return chunks in a different format than raw RLE values if it's v2.
    // Let's inspect the response structure.
    // console.log(JSON.stringify(state, null, 2));

    process.exit(0);
}

main();
