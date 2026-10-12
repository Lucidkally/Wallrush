'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const WR = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const RESET_OFFSET_H = Number(process.env.RESET_UTC_OFFSET_HOURS || 1); // 1 = Lagos midnight
const TURN_MS = Number(process.env.TURN_SECONDS || 60) * 1000;
const RECONNECT_MS = 30000;
const WIN_POINTS = 25, QUEST_BONUS = 40, QUEST_MAX_WALLS = 3;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- persistence ---------------- */
let players = {};
try { players = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
let dirty = false;
function flush(sync) {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(players));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) { console.error('save failed', e.message); }
}
setInterval(flush, 5000).unref();
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

const dayKey = () => new Date(Date.now() + RESET_OFFSET_H * 3600e3).toISOString().slice(0, 10);
function rollDay(p) {
  const k = dayKey();
  if (p.day !== k) { p.day = k; p.dayPoints = 0; p.dayWins = 0; p.questDone = false; }
}
function getPlayer(id, name) {
  let p = players[id];
  if (!p) {
    p = players[id] = {
      id, name: cleanName(name) || 'User' + (1000 + crypto.randomInt(9000)),
      points: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0,
      day: dayKey(), dayPoints: 0, dayWins: 0, questDone: false, created: Date.now()
    };
    dirty = true;
  }
  rollDay(p);
  return p;
}
function cleanName(n) {
  if (typeof n !== 'string') return '';
  return n.replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 16);
}
const pub = p => ({
  name: p.name, points: p.points, wins: p.wins, losses: p.losses, streak: p.streak,
  bestStreak: p.bestStreak, dayPoints: p.dayPoints, dayWins: p.dayWins, questDone: p.questDone
});

function ranking(scope, id) {
  const all = scope === 'all';
  const key = all ? 'points' : 'dayPoints';
  const arr = Object.values(players);
  arr.forEach(rollDay);
  const list = arr.filter(p => p[key] > 0)
    .sort((a, b) => b[key] - a[key] || (all ? b.wins - a.wins : b.dayWins - a.dayWins) || a.created - b.created);
  const idx = list.findIndex(p => p.id === id);
  const me = players[id];
  return {
    type: 'ranking', scope,
    list: list.slice(0, 100).map(p => ({ name: p.name, score: p[key], wins: all ? p.wins : p.dayWins, me: p.id === id })),
    you: me ? { rank: idx >= 0 ? idx + 1 : list.length + 1, name: me.name, score: me[key], wins: all ? me.wins : me.dayWins } : null
  };
}

/* ---------------- state ---------------- */
const clients = new Map();   // id -> {id, ws, gameId, room}
const games = new Map();     // gameId -> game
const rooms = new Map();     // code -> {code, host, pub}
let queue = [];

const send = (c, o) => { if (c && c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
const live = id => { const c = clients.get(id); return c && c.ws && c.ws.readyState === 1 ? c : null; };

let onlineTimer = null;
function broadcastOnline() {
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    const n = [...clients.values()].filter(c => c.ws).length;
    for (const c of clients.values()) send(c, { type: 'online', n });
  }, 1500);
}

function removeFromQueue(id) { queue = queue.filter(x => x !== id); }
function dropRoom(c) {
  if (c.room) { const r = rooms.get(c.room); if (r && r.host === c.id) rooms.delete(c.room); c.room = null; }
}
function leaveLobby(c) { removeFromQueue(c.id); dropRoom(c); }

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = '';
    for (let i = 0; i < 5; i++) s += A[crypto.randomInt(A.length)];
    if (!rooms.has(s)) return s;
  }
}

/* ---------------- games ---------------- */
function gamePayload(g, idx, resumed) {
  const oc = clients.get(g.players[1 - idx]);
  return {
    type: 'game_start', you: idx, state: g.state, ranked: g.ranked, resumed: !!resumed,
    opp: { name: players[g.players[1 - idx]].name },
    remaining: Math.max(0, g.deadline - Date.now()),
    oppConnected: !!(oc && oc.ws)
  };
}
function setTurnTimer(g) {
  clearTimeout(g.timer);
  g.deadline = Date.now() + TURN_MS;
  g.timer = setTimeout(() => endGame(g, 1 - g.state.turn, 'timeout'), TURN_MS + 300);
}
function startGame(a, b, ranked) {
  leaveLobby(a); leaveLobby(b);
  const ids = Math.random() < 0.5 ? [a.id, b.id] : [b.id, a.id];
  const g = {
    id: crypto.randomBytes(6).toString('hex'), players: ids, state: WR.newState(),
    ranked, timer: null, disc: [null, null], over: false, deadline: 0
  };
  games.set(g.id, g);
  a.gameId = b.gameId = g.id;
  setTurnTimer(g);
  ids.forEach((id, i) => send(clients.get(id), gamePayload(g, i)));
}
function endGame(g, winIdx, reason) {
  if (g.over) return;
  g.over = true;
  clearTimeout(g.timer);
  g.disc.forEach(clearTimeout);
  games.delete(g.id);
  const farmGuard = g.state.moves < 4 && reason !== 'goal';
  g.players.forEach((id, idx) => {
    const p = players[id];
    rollDay(p);
    let gain = 0, bonus = 0;
    const won = idx === winIdx;
    if (g.ranked && !farmGuard) {
      if (won) {
        p.wins++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
        gain = WIN_POINTS;
        if (!p.questDone && reason === 'goal' && g.state.used[idx] <= QUEST_MAX_WALLS) {
          bonus = QUEST_BONUS; p.questDone = true;
        }
        p.points += gain + bonus; p.dayPoints += gain + bonus; p.dayWins++;
      } else { p.losses++; p.streak = 0; }
      dirty = true;
    }
    const c = clients.get(id);
    if (c) {
      c.gameId = null;
      send(c, { type: 'game_over', winner: winIdx, you: idx, reason, gain, bonus, ranked: g.ranked && !farmGuard, profile: pub(p) });
      if (!c.ws) clients.delete(id);
    }
  });
}
function onAction(c, msg) {
  const g = games.get(c.gameId);
  if (!g) return send(c, { type: 'error', msg: 'No active game' });
  const idx = g.players.indexOf(c.id);
  const res = WR.apply(g.state, idx, msg.action);
  if (!res.ok) return send(c, { type: 'error', code: 'illegal', msg: res.error });
  g.state = res.state;
  const won = g.state.winner !== null;
  if (!won) setTurnTimer(g);
  const payload = { type: 'state', state: g.state, last: msg.action, by: idx, remaining: TURN_MS };
  g.players.forEach(id => send(clients.get(id), payload));
  if (won) endGame(g, idx, 'goal');
}

/* ---------------- message handling ---------------- */
function listRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.pub || !live(r.host)) continue;
    const p = players[r.host];
    out.push({ code: r.code, host: p.name, points: p.points });
    if (out.length >= 30) break;
  }
  return out;
}

function onMessage(c, m) {
  switch (m.type) {
    case 'rename': {
      const n = cleanName(m.name);
      if (n.length < 2) return send(c, { type: 'error', msg: 'Name must be at least 2 characters' });
      players[c.id].name = n; dirty = true;
      return send(c, { type: 'you', you: pub(players[c.id]) });
    }
    case 'quick': {
      if (c.gameId) return;
      leaveLobby(c);
      queue = queue.filter(id => live(id));
      const other = queue.find(id => id !== c.id);
      if (other) { removeFromQueue(other); return startGame(clients.get(other), c, true); }
      queue.push(c.id);
      return send(c, { type: 'queue' });
    }
    case 'cancel_queue': return removeFromQueue(c.id);
    case 'create_room': {
      if (c.gameId) return;
      leaveLobby(c);
      const code = roomCode();
      rooms.set(code, { code, host: c.id, pub: !!m.pub });
      c.room = code;
      return send(c, { type: 'room_created', code, pub: !!m.pub });
    }
    case 'leave_room': return dropRoom(c);
    case 'join_room': {
      if (c.gameId) return;
      const code = String(m.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(c, { type: 'error', msg: 'Room not found or already started' });
      if (r.host === c.id) return send(c, { type: 'error', msg: "That's your own room" });
      const host = live(r.host);
      if (!host) { rooms.delete(code); return send(c, { type: 'error', msg: 'Host left the room' }); }
      rooms.delete(code); host.room = null;
      return startGame(host, c, r.pub);
    }
    case 'rooms': return send(c, { type: 'rooms', list: listRooms() });
    case 'action': return onAction(c, m);
    case 'resign': {
      const g = games.get(c.gameId);
      if (g) endGame(g, 1 - g.players.indexOf(c.id), 'resign');
      return;
    }
    case 'ranking': return send(c, ranking(m.scope === 'all' ? 'all' : 'today', c.id));
  }
}

function onDisconnect(c, ws) {
  if (c.ws !== ws) return;
  c.ws = null;
  leaveLobby(c);
  const g = games.get(c.gameId);
  if (g) {
    const idx = g.players.indexOf(c.id);
    g.disc[idx] = setTimeout(() => endGame(g, 1 - idx, 'disconnect'), RECONNECT_MS);
    send(clients.get(g.players[1 - idx]), { type: 'opp_status', connected: false });
  } else clients.delete(c.id);
  broadcastOnline();
}

/* ---------------- http + ws ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, url));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let c = null, count = 0;
  const rl = setInterval(() => { count = 0; }, 1000);
  ws.on('message', data => {
    if (++count > 25) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;
    if (!c) {
      if (m.type !== 'hello' || typeof m.id !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(m.id)) return;
      const old = clients.get(m.id);
      if (old && old.ws && old.ws !== ws) {
        send(old, { type: 'replaced' });
        const o = old.ws; old.ws = null; try { o.close(); } catch (e) {}
      }
      c = old || { id: m.id, ws: null, gameId: null, room: null };
      c.ws = ws;
      clients.set(c.id, c);
      const p = getPlayer(c.id, m.name);
      send(c, { type: 'welcome', you: pub(p), online: [...clients.values()].filter(x => x.ws).length });
      const g = games.get(c.gameId);
      if (g) {
        const idx = g.players.indexOf(c.id);
        clearTimeout(g.disc[idx]);
        send(c, gamePayload(g, idx, true));
        send(clients.get(g.players[1 - idx]), { type: 'opp_status', connected: true });
      }
      broadcastOnline();
      return;
    }
    onMessage(c, m);
  });
  ws.on('close', () => { clearInterval(rl); if (c) onDisconnect(c, ws); });
  ws.on('error', () => {});
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000).unref();

server.listen(PORT, () => console.log('WallRush listening on :' + PORT));
