// Debug script to diagnose server/client issues
console.log('=== Meetropolis Debug Script ===');

// Check 1: Test server connectivity
async function testServerConnectivity() {
  console.log('\n1. Testing Server Connectivity...');
  
  const baseUrl = 'http://localhost:2568';
  
  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    console.log('✓ Health endpoint:', healthRes.status, await healthRes.text());
  } catch (e) {
    console.log('✗ Health endpoint failed:', e.message);
    return false;
  }

  try {
    const mapsRes = await fetch(`${baseUrl}/maps`);
    console.log('✓ Maps endpoint:', mapsRes.status);
    const maps = await mapsRes.json();
    console.log('  Maps:', maps.map(m => ({ name: m.name, hasZones: m.zones?.length || 0 })));
  } catch (e) {
    console.log('✗ Maps endpoint failed:', e.message);
  }

  try {
    const editorRes = await fetch(`${baseUrl}/maps/office/editor-state`);
    console.log('✓ Editor state endpoint:', editorRes.status);
    if (editorRes.ok) {
      const editorData = await editorRes.json();
      console.log('  Editor data:', {
        hasEditorGround: !!editorData.editorGround,
        hasCollision: !!editorData.collision,
        editorGroundLength: editorData.editorGround?.length || 0,
        collisionLength: editorData.collision?.length || 0,
        zones: editorData.zones?.length || 0
      });
    }
  } catch (e) {
    console.log('✗ Editor state endpoint failed:', e.message);
  }

  return true;
}

// Check 2: Test position persistence
async function testPositionPersistence() {
  console.log('\n2. Testing Position Persistence...');
  
  try {
    const meRes = await fetch('http://localhost:2567/auth/me', {
      credentials: 'include'
    });
    
    if (meRes.status === 401) {
      console.log('✗ Not authenticated - cannot test position persistence');
      return;
    }
    
    console.log('✓ Auth check:', meRes.status);
    const userData = await meRes.json();
    console.log('  User data:', {
      id: userData.id,
      name: userData.name,
      hasLastPosition: !!userData.lastPosition,
      lastPosition: userData.lastPosition
    });
  } catch (e) {
    console.log('✗ Position check failed:', e.message);
  }
}

// Check 3: Inspect localStorage
function checkLocalStorage() {
  console.log('\n3. Checking LocalStorage...');
  
  const editorLayers = localStorage.getItem('meetropolis.editorLayers');
  if (editorLayers) {
    try {
      const data = JSON.parse(editorLayers);
      console.log('✓ Editor layers in localStorage:', {
        hasEditorGround: !!data.editorGround,
        hasCollision: !!data.collision,
        editorGroundLength: data.editorGround?.length || 0,
        collisionLength: data.collision?.length || 0,
        dimensions: `${data.w || 'unknown'}x${data.h || 'unknown'}`
      });
    } catch (e) {
      console.log('✗ Invalid editor layers JSON in localStorage');
    }
  } else {
    console.log('○ No editor layers in localStorage');
  }

  const tilesets = localStorage.getItem('meetropolis.tilesets');
  if (tilesets) {
    try {
      const ts = JSON.parse(tilesets);
      console.log('✓ Tilesets in localStorage:', ts.length, 'tilesets');
    } catch (e) {
      console.log('✗ Invalid tilesets JSON in localStorage');
    }
  } else {
    console.log('○ No tilesets in localStorage');
  }
}

// Check 4: Test WebSocket connectivity for Colyseus
async function testColyseus() {
  console.log('\n4. Testing Colyseus WebSocket...');
  
  try {
    const wsUrl = 'ws://localhost:2567';
    console.log('Attempting WebSocket connection to:', wsUrl);
    
    // We can't easily test WebSocket from Node.js, so we'll skip this
    console.log('○ WebSocket test skipped (requires browser environment)');
  } catch (e) {
    console.log('✗ WebSocket test failed:', e.message);
  }
}

// Main execution
async function main() {
  const serverOnline = await testServerConnectivity();
  
  if (serverOnline) {
    await testPositionPersistence();
  }
  
  // These work in Node.js with jsdom or similar, but let's keep it simple
  console.log('\n○ LocalStorage and WebSocket checks require browser environment');
  console.log('\n=== Debug Complete ===');
  console.log('\nTo run browser-specific checks:');
  console.log('1. Open browser dev tools');
  console.log('2. Run: checkLocalStorage()');
  console.log('3. Check network tab for WebSocket connections');
}

// Export functions for browser use
if (typeof window !== 'undefined') {
  window.debugMeetropolis = {
    testServerConnectivity,
    testPositionPersistence,
    checkLocalStorage,
    testColyseus
  };
}

main().catch(console.error);