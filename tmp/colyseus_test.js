const { Client } = require('colyseus.js');
(async () => {
  const url = 'ws://server:2567';
  const client = new Client(url);
  const a = await client.joinOrCreate('world');
  const b = await client.joinOrCreate('world');
  let stateSeen = false;
  a.onStateChange.once(() => { stateSeen = true; });
  a.send('move', { x: 100, y: 100, direction: 'down' });
  setTimeout(() => {
    console.log(JSON.stringify({ sessionA: a.sessionId, sessionB: b.sessionId, stateSeen }));
    a.leave();
    b.leave();
  }, 800);
})();
