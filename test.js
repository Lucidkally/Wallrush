// Starts the server on a spare port and plays two AI-driven bots against each other.
const { spawn } = require('child_process');
const WebSocket = require('ws');
const WR = require('./public/game.js');
const fs = require('fs'), os = require('os'), path = require('path');

const PORT = 3999;
const data = path.join(os.tmpdir(), 'wr-test-' + Date.now() + '.json');
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_FILE: data }, stdio: 'inherit' });
const fail = m => { console.error('FAIL:', m); srv.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), 90000);

function bot(id, name) {
  return new Promise(resolve => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    const b = { ws, me: null, state: null, over: null };
    const play = () => {
      if (b.state && b.state.turn === b.me && b.state.winner === null) {
        const a = WR.aiMove(b.state, b.me, 'medium');
        ws.send(JSON.stringify({ type: 'action', action: a }));
      }
    };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', id, name })));
    ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'welcome') resolve(b);
      if (m.type === 'game_start') { b.me = m.you; b.state = m.state; play(); }
      if (m.type === 'state') { b.state = m.state; play(); }
      if (m.type === 'error') fail('server error: ' + m.msg);
      if (m.type === 'game_over') b.over = m;
    });
    b.quick = () => ws.send(JSON.stringify({ type: 'quick' }));
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 800));
  const a = await bot('aaaaaaaaaaaaaaaa', 'Alice'), b = await bot('bbbbbbbbbbbbbbbb', 'Bob');
  a.quick(); b.quick();
  const t0 = Date.now();
  while (!(a.over && b.over)) { if (Date.now() - t0 > 80000) fail('game did not finish'); await new Promise(r => setTimeout(r, 100)); }
  if (a.over.winner !== b.over.winner) fail('winner mismatch');
  const winner = a.over.you === a.over.winner ? a : b;
  if (winner.over.gain !== 25) fail('expected 25 points, got ' + winner.over.gain);
  console.log('OK: game finished, winner is player', a.over.winner, 'moves', a.state.moves, 'points', winner.over.gain, 'bonus', winner.over.bonus);
  // rules spot checks
  let s = WR.newState();
  if (WR.pawnMoves(s, 0).length !== 3) fail('start moves');
  s = WR.apply(s, 0, { t: 'wall', o: 'h', r: 0, c: 0 }).state;
  if (!WR.canWall(s, 1, 'h', 0, 1)) fail('overlap allowed');
  if (!WR.canWall(s, 1, 'v', 0, 0)) fail('cross allowed');
  console.log('OK: rule checks');
  srv.kill(); process.exit(0);
})();
