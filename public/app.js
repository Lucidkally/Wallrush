'use strict';
(() => {
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function el(t, c, x) { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

let myId = store.get('wr_id', '');
if (!/^[A-Za-z0-9]{16,}$/.test(myId)) {
  myId = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  store.set('wr_id', myId);
}
let profile = { name: '', points: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, dayPoints: 0, dayWins: 0, questDone: false };
let online = 0, ws = null, wsOpen = false, retry = 0;
let pendingRoom = new URLSearchParams(location.search).get('room');
if (pendingRoom) history.replaceState(null, '', location.pathname);
const U = 100 / 11, STEP = U * 1.25;

/* ---------- helpers ---------- */
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 2400); }
function buzz(n) { try { navigator.vibrate && navigator.vibrate(n); } catch (e) {} }
function modal(build) {
  const mc = $('#modal .mc'); mc.innerHTML = ''; build(mc); $('#modal').classList.add('show');
}
function closeModal() { $('#modal').classList.remove('show'); }
function btn(label, fn, alt) { const b = el('button', 'btn' + (alt ? ' alt' : ''), label); b.onclick = fn; return b; }
function avatar(name, cls) { return el('div', 'av' + (cls ? ' ' + cls : ''), (name || '?')[0].toUpperCase()); }

/* ---------- navigation ---------- */
let roomsPoll = null, rankScope = 'today';
function show(id) {
  $$('.screen').forEach(e => e.classList.toggle('active', e.id === id));
  const tabbed = ['home', 'ranking', 'profile'].includes(id);
  $('#tabs').style.display = tabbed ? 'flex' : 'none';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === id));
  clearInterval(roomsPoll);
  if (id === 'ranking') send({ type: 'ranking', scope: rankScope });
  if (id === 'lobby') { send({ type: 'rooms' }); roomsPoll = setInterval(() => send({ type: 'rooms' }), 3000); }
  if (id === 'profile') renderProfile();
  $('#' + id).scrollTop = 0;
}
$$('[data-go]').forEach(b => b.onclick = () => { if (gm && !gm.over && b.dataset.go !== 'game') return; show(b.dataset.go); });

/* ---------- websocket ---------- */
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host);
  ws.onopen = () => { wsOpen = true; retry = 0; $('#connDot').classList.add('on'); send({ type: 'hello', id: myId, name: store.get('wr_name', '') }); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
  ws.onclose = () => { wsOpen = false; $('#connDot').classList.remove('on'); setTimeout(connect, Math.min(5000, 500 * ++retry)); };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

function onMsg(m) {
  switch (m.type) {
    case 'welcome':
      profile = m.you; online = m.online; store.set('wr_name', profile.name); renderHome();
      if (pendingRoom) { send({ type: 'join_room', code: pendingRoom }); pendingRoom = null; }
      break;
    case 'you': profile = m.you; store.set('wr_name', profile.name); renderHome(); renderProfile(); break;
    case 'online': online = m.n; renderHome(); break;
    case 'replaced': toast('Opened in another tab'); break;
    case 'queue': showSearching(); break;
    case 'room_created': showWaiting(m); break;
    case 'rooms': renderRooms(m.list); break;
    case 'ranking': renderRanking(m); break;
    case 'error':
      if (gm && gm.kind === 'online') gm.busy = false;
      toast(m.msg); if (gm) render(); break;
    case 'game_start':
      closeModal(); clearTimeout(searchT);
      startGame('online', m.you, m.state, m.opp.name, null, m.ranked);
      gm.remaining = m.remaining; gm.tickAt = Date.now();
      if (m.resumed) toast('Reconnected');
      if (m.oppConnected === false) gm.oppDown = true;
      render();
      break;
    case 'state':
      if (!gm || gm.kind !== 'online') break;
      gm.state = m.state; gm.busy = false; gm.sel = null; gm.mode = 'move';
      gm.remaining = m.remaining; gm.tickAt = Date.now(); gm.oppDown = false;
      if (m.by !== gm.me) buzz(20);
      render();
      break;
    case 'opp_status':
      if (gm) { gm.oppDown = !m.connected; render(); }
      break;
    case 'game_over':
      if (!gm || gm.over) break;
      profile = m.profile; renderHome();
      finish(m.winner === m.you, m);
      break;
  }
}

/* ---------- home / profile / ranking ---------- */
function renderHome() {
  $('#onlineN').textContent = online || '–';
  $('#streakN').textContent = profile.streak;
  $('#pointsN').textContent = profile.points;
  $('#questN').textContent = (profile.questDone ? 1 : 0) + '/1';
  $('#questBar').style.width = profile.questDone ? '100%' : '0';
}
function renderProfile() {
  $('#profAv').textContent = (profile.name || 'U')[0].toUpperCase();
  $('#profName').textContent = profile.name;
  $('#stPoints').textContent = profile.points; $('#stWins').textContent = profile.wins;
  $('#stLosses').textContent = profile.losses;
  const t = profile.wins + profile.losses;
  $('#stRate').textContent = t ? Math.round(profile.wins / t * 100) + '%' : '0%';
  $('#stStreak').textContent = profile.streak; $('#stBest').textContent = profile.bestStreak;
}
$('#btnRename').onclick = () => modal(mc => {
  mc.append(el('h3', '', 'Change name'));
  const i = el('input'); i.maxLength = 16; i.value = profile.name; mc.append(i);
  const b = el('div', 'btns');
  b.append(btn('Save', () => { send({ type: 'rename', name: i.value }); closeModal(); }), btn('Cancel', closeModal, true));
  mc.append(b);
});
function setScope(s) {
  rankScope = s;
  $('#rkToday').classList.toggle('on', s === 'today'); $('#rkAll').classList.toggle('on', s === 'all');
  $('#rankSub').textContent = s === 'today' ? "Today's top 100 · resets at midnight (Lagos time)" : 'All-time top 100';
  send({ type: 'ranking', scope: s });
}
$('#rkToday').onclick = () => setScope('today'); $('#rkAll').onclick = () => setScope('all');
function rankRow(rank, e, mine) {
  const row = el('div', 'rrow' + (mine ? ' mine' : ''));
  row.append(el('div', 'rk', rank <= 3 && !mine ? ['🥇', '🥈', '🥉'][rank - 1] : '#' + rank), avatar(e.name), el('div', 'rn', e.name));
  const rs = el('div', 'rs'); rs.append(el('b', '', '+' + e.score), el('span', '', 'points · ' + e.wins + ' Wins'));
  row.append(rs); return row;
}
function renderRanking(m) {
  if (m.scope !== rankScope) return;
  const box = $('#rankList'); box.innerHTML = '';
  if (!m.list.length) box.append(el('div', 'empty', 'No games yet — be the first!'));
  m.list.forEach((e, i) => box.append(rankRow(i + 1, e, e.me)));
  const y = $('#rankYou'); y.innerHTML = '';
  if (m.you) y.append(rankRow(m.you.rank, m.you, true));
}

/* ---------- lobby / rooms ---------- */
function renderRooms(list) {
  const box = $('#roomList'); box.innerHTML = '';
  if (!list.length) { box.append(el('div', 'empty', 'No open rooms right now. Create one!')); return; }
  list.forEach(r => {
    const row = el('div', 'roomrow'); row.append(avatar(r.host));
    const n = el('div', 'rn', r.host); n.append(el('small', '', '⭐ ' + r.points));
    row.append(n, btn('Join', () => send({ type: 'join_room', code: r.code })));
    row.lastChild.className = 'mini go'; box.append(row);
  });
}
$('#btnPublic').onclick = () => show('lobby');
$('#btnFriend').onclick = () => show('friend');
$('#btnCreatePublic').onclick = () => send({ type: 'create_room', pub: true });
$('#btnCreatePrivate').onclick = () => send({ type: 'create_room', pub: false });
$('#btnJoin').onclick = () => { const c = $('#codeIn').value.trim(); if (c.length < 4) return toast('Enter the room code'); send({ type: 'join_room', code: c }); };
function showWaiting(m) {
  modal(mc => {
    mc.append(el('h3', '', m.pub ? 'Waiting for an opponent…' : 'Share this code'));
    mc.append(el('div', 'code', m.code));
    mc.append(el('div', 'spin'));
    mc.append(el('p', '', m.pub ? 'Your room is listed in Public rooms.' : 'Your friend can enter it under "Play with friend", or open your link.'));
    const b = el('div', 'btns');
    const link = location.origin + '/?room=' + m.code;
    b.append(btn('Share invite', async () => {
      const text = 'Play WallRush with me! Code: ' + m.code;
      try { if (navigator.share) { await navigator.share({ title: 'WallRush', text, url: link }); return; } } catch (e) { return; }
      try { await navigator.clipboard.writeText(text + ' ' + link); toast('Link copied'); } catch (e) { toast(link); }
    }), btn('Cancel', () => { send({ type: 'leave_room' }); closeModal(); }, true));
    mc.append(b);
  });
}
let searchT;
function showSearching() {
  modal(mc => {
    mc.append(el('h3', '', 'Finding opponent…'), el('div', 'spin'), el('p', '', 'Matching you with a player'));
    const b = el('div', 'btns'); b.append(btn('Cancel', () => { send({ type: 'cancel_queue' }); clearTimeout(searchT); closeModal(); }, true));
    mc.append(b);
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      mc.querySelector('p').textContent = 'Nobody yet. Play the AI while you wait?';
      b.prepend(btn('Play vs AI', () => { send({ type: 'cancel_queue' }); closeModal(); chooseAI(); }));
    }, 12000);
  });
}
$('#btnQuick').onclick = () => { if (!wsOpen) return toast('Connecting…'); send({ type: 'quick' }); };

/* ---------- AI / how to ---------- */
function chooseAI() {
  modal(mc => {
    mc.append(el('h3', '', 'Choose difficulty'));
    const b = el('div', 'btns');
    [['😊 Easy', 'easy'], ['🙂 Medium', 'medium'], ['😈 Hard', 'hard']].forEach(([l, v]) =>
      b.append(btn(l, () => { closeModal(); startGame('ai', 0, WR.newState(), 'Robot (' + v + ')', v, false); })));
    b.append(btn('Cancel', closeModal, true)); mc.append(b);
  });
}
$('#btnAI').onclick = chooseAI;
$('#btnHow').onclick = () => modal(mc => {
  mc.append(el('h3', '', 'How to play'));
  const ul = el('ul');
  ['Reach the opposite side of the board before your opponent. You start at the bottom.',
   'On your turn do ONE thing: move your pawn one square, or place a wall.',
   'Walls are two squares long and block movement. You have 10 each.',
   "You can't completely seal off a player's path to their goal — there must always be a way through.",
   'Pawns face to face: jump over your opponent. If a wall is behind them, step diagonally.',
   'Tap Wall, tap a dot on the board, rotate if needed, then Place.',
   'Win with 3 walls or fewer for the daily +40 bonus. Ranked wins are +25 points.']
    .forEach(t => ul.append(el('li', '', t)));
  mc.append(ul); const b = el('div', 'btns'); b.append(btn('Got it', closeModal)); mc.append(b);
});

/* ---------- game ---------- */
let gm = null;
const toS = (R, C) => gm.flip ? [8 - R, 8 - C] : [R, C];
const toW = (R, C) => gm.flip ? [7 - R, 7 - C] : [R, C];
const myTurn = () => gm && !gm.over && !gm.busy && !gm.thinking && gm.state.turn === gm.me;

function startGame(kind, me, state, oppName, level, ranked) {
  gm = { kind, me, state, flip: me === 1, mode: 'move', sel: null, oppName, level, ranked, over: false, busy: false, thinking: false, remaining: null, tickAt: 0, oppDown: false };
  closeModal();
  buildBoard();
  $('#oppName').textContent = oppName; $('#myName').textContent = profile.name || 'You';
  $('#rankedTag').textContent = kind === 'ai' ? 'Practice' : ranked ? 'Ranked' : 'Friendly';
  show('game'); render();
  if (kind === 'ai' && state.turn !== me) aiTurn();
}
function place(node, R, C) { node.style.left = C * STEP + '%'; node.style.top = R * STEP + '%'; }
function buildBoard() {
  const b = $('#board'); b.innerHTML = '';
  for (let R = 0; R < 9; R++) for (let C = 0; C < 9; C++) {
    const d = el('div', 'cell' + (R === 0 ? ' gm' : R === 8 ? ' go' : '')); place(d, R, C);
    d.dataset.r = R; d.dataset.c = C; b.append(d);
  }
  const wl = el('div'); wl.id = 'wallLayer'; b.append(wl);
  for (let R = 0; R < 8; R++) for (let C = 0; C < 8; C++) {
    const h = el('div', 'hit');
    h.style.left = (C * STEP + U * 0.625) + '%'; h.style.top = (R * STEP + U * 0.625) + '%';
    h.dataset.r = R; h.dataset.c = C; b.append(h);
  }
  const pm = el('div', 'pawn me'); pm.append(el('i')); pm.id = 'pawnMe';
  const po = el('div', 'pawn opp'); po.append(el('i')); po.id = 'pawnOpp';
  b.append(pm, po);
}
$('#board').addEventListener('click', e => {
  if (!gm) return;
  const hit = e.target.closest('.hit'), cell = e.target.closest('.cell');
  if (hit && gm.mode === 'wall') return onHit(+hit.dataset.r, +hit.dataset.c);
  if (cell && gm.mode === 'move') return onCell(+cell.dataset.r, +cell.dataset.c);
});
function onCell(R, C) {
  if (!myTurn()) return;
  const [r, c] = toS(R, C);
  if (WR.pawnMoves(gm.state, gm.me).some(m => m.r === r && m.c === c)) act({ t: 'move', r, c });
}
function validWall(w) { return w && !WR.canWall(gm.state, gm.me, w.o, w.r, w.c); }
function onHit(R, C) {
  if (!myTurn()) return;
  const [r, c] = toW(R, C);
  if (gm.sel && gm.sel.r === r && gm.sel.c === c) gm.sel.o = gm.sel.o === 'h' ? 'v' : 'h';
  else {
    let o = 'h';
    if (WR.canWall(gm.state, gm.me, 'h', r, c) && !WR.canWall(gm.state, gm.me, 'v', r, c)) o = 'v';
    gm.sel = { o, r, c };
  }
  render();
}
function setMode(m) { if (!gm || gm.over) return; gm.mode = m; gm.sel = null; render(); }
$('#modeMove').onclick = () => setMode('move');
$('#modeWall').onclick = () => { if (gm && gm.state.left[gm.me] <= 0) return toast('No walls left'); setMode('wall'); };
$('#btnRotate').onclick = () => { if (gm && gm.sel) { gm.sel.o = gm.sel.o === 'h' ? 'v' : 'h'; render(); } };
$('#btnPlace').onclick = () => {
  if (!myTurn() || !gm.sel) return;
  const w = gm.sel;
  const err = WR.canWall(gm.state, gm.me, w.o, w.r, w.c);
  if (err) return toast(err);
  act({ t: 'wall', o: w.o, r: w.r, c: w.c });
};
$('#btnResign').onclick = () => {
  if (!gm) return;
  if (gm.over) { show('home'); return; }
  modal(mc => {
    mc.append(el('h3', '', 'Resign?'), el('p', '', 'You will lose this match.'));
    const b = el('div', 'btns');
    b.append(btn('Resign', () => {
      closeModal();
      if (gm.kind === 'online') send({ type: 'resign' });
      else { gm.over = true; show('home'); }
    }), btn('Keep playing', closeModal, true));
    mc.append(b);
  });
};

function act(a) {
  if (gm.kind === 'online') { gm.busy = true; send({ type: 'action', action: a }); render(); return; }
  const res = WR.apply(gm.state, gm.me, a);
  if (!res.ok) return toast(res.error);
  gm.state = res.state; gm.sel = null; gm.mode = 'move'; render();
  if (gm.state.winner !== null) return finish(true, {});
  aiTurn();
}
function aiTurn() {
  gm.thinking = true; render();
  const g = gm;
  setTimeout(() => {
    if (gm !== g || g.over) return;
    const ai = 1 - g.me;
    const a = WR.aiMove(g.state, ai, g.level);
    const res = WR.apply(g.state, ai, a);
    g.thinking = false;
    if (res.ok) { g.state = res.state; buzz(15); }
    render();
    if (g.state.winner !== null) finish(false, {});
  }, 600);
}

function finish(won, info) {
  gm.over = true; render();
  const online = gm.kind === 'online';
  setTimeout(() => modal(mc => {
    mc.append(el('div', 'big-emoji', won ? '🎉' : '😔'));
    mc.append(el('h3', '', won ? 'You won!' : 'You lost'));
    const why = { resign: won ? 'Opponent resigned' : 'You resigned', timeout: won ? 'Opponent ran out of time' : 'You ran out of time', disconnect: 'Opponent disconnected' }[info.reason];
    if (why && !(info.reason === 'disconnect' && !won)) mc.append(el('p', '', why));
    if (info.gain) mc.append(el('p', '', '+' + info.gain + ' points' + (info.bonus ? ' (+' + info.bonus + ' quest bonus 🎯)' : '')));
    else if (online && won && info.ranked === false && gm.ranked) mc.append(el('p', '', 'Game too short to earn points.'));
    const b = el('div', 'btns');
    const kind = gm.kind, lvl = gm.level, ranked = gm.ranked;
    b.append(btn('Play again', () => {
      closeModal();
      if (kind === 'ai') startGame('ai', 0, WR.newState(), 'Robot (' + lvl + ')', lvl, false);
      else if (ranked) { show('home'); send({ type: 'quick' }); }
      else show('friend');
    }), btn('Home', () => { closeModal(); show('home'); }, true));
    mc.append(b);
  }), 500);
}

function wallsBar(node, n) { node.innerHTML = ''; for (let i = 0; i < 10; i++) node.append(el('s', i >= n ? 'u' : '')); }
function render() {
  if (!gm) return;
  const s = gm.state;
  const dp = p => gm.flip ? [8 - s.pawns[p].r, 8 - s.pawns[p].c] : [s.pawns[p].r, s.pawns[p].c];
  place($('#pawnMe'), ...dp(gm.me)); place($('#pawnOpp'), ...dp(1 - gm.me));
  const layer = $('#wallLayer'); layer.innerHTML = '';
  const drawWall = (w, cls) => {
    const [R, C] = toW(w.r, w.c), d = el('div', 'wall' + (cls ? ' ' + cls : ''));
    if (w.o === 'h') { d.style.left = C * STEP + '%'; d.style.top = (R * STEP + U) + '%'; d.style.width = (U + STEP) + '%'; d.style.height = (U * 0.25) + '%'; }
    else { d.style.left = (C * STEP + U) + '%'; d.style.top = R * STEP + '%'; d.style.width = (U * 0.25) + '%'; d.style.height = (U + STEP) + '%'; }
    layer.append(d);
  };
  s.walls.forEach(w => drawWall(w));
  if (gm.sel && gm.mode === 'wall') drawWall(gm.sel, 'pv ' + (validWall(gm.sel) ? 'ok' : 'bad'));
  const mt = myTurn();
  const legal = mt && gm.mode === 'move' ? WR.pawnMoves(s, gm.me) : [];
  $$('#board .cell').forEach(c => {
    const [r, cc] = toS(+c.dataset.r, +c.dataset.c);
    c.classList.toggle('legal', legal.some(m => m.r === r && m.c === cc));
  });
  $$('#board .hit').forEach(h => h.classList.toggle('on', mt && gm.mode === 'wall'));
  wallsBar($('#myWalls'), s.left[gm.me]); wallsBar($('#oppWalls'), s.left[1 - gm.me]);
  $('#modeMove').classList.toggle('on', gm.mode === 'move'); $('#modeWall').classList.toggle('on', gm.mode === 'wall');
  $('#wallActs').classList.toggle('show', gm.mode === 'wall');
  $('#btnPlace').disabled = !(mt && gm.sel && validWall(gm.sel));
  $('#btnPlace').style.opacity = $('#btnPlace').disabled ? .45 : 1;
  const st = $('#status');
  st.className = mt ? 'mine' : '';
  if (gm.over) st.textContent = 'Game over';
  else if (gm.oppDown) st.textContent = 'Opponent disconnected — waiting…';
  else if (gm.thinking) st.textContent = 'Robot is thinking…';
  else if (s.turn === gm.me) st.textContent = gm.mode === 'wall' ? (gm.sel ? (validWall(gm.sel) ? 'Tap again to rotate, then Place' : 'Not allowed here — tap again to rotate') : 'Tap a dot to place a wall') : 'Your turn — tap a highlighted square';
  else st.textContent = "Opponent's turn";
  $('#btnResign').textContent = gm.over ? 'Back to home' : 'Resign';
}

setInterval(() => {
  const mc = $('#myClock'), oc = $('#oppClock');
  if (!gm || gm.over || gm.kind !== 'online' || gm.remaining == null) { mc.textContent = oc.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((gm.remaining - (Date.now() - gm.tickAt)) / 1000));
  const mine = gm.state.turn === gm.me;
  mc.textContent = mine ? left + 's' : ''; oc.textContent = mine ? '' : left + 's';
  mc.classList.toggle('low', mine && left <= 10);
}, 250);

renderHome();
show('home');
connect();
})();
