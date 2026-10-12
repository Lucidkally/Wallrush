/* WallRush rules + AI. Shared by the server (authoritative) and the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const N = 9, WALLS = 10, GOAL = [0, 8];
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

  // Player 0 starts bottom (row 8) and must reach row 0. Player 1 is the reverse.
  function newState() {
    return {
      pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }],
      walls: [],            // {o:'h'|'v', r, c}  r,c in 0..7
      left: [WALLS, WALLS],
      used: [0, 0],
      turn: 0,
      winner: null,
      moves: 0
    };
  }

  function wallIndex(walls) {
    const h = new Set(), v = new Set();
    for (const w of walls) (w.o === 'h' ? h : v).add(w.r * 8 + w.c);
    return { h, v };
  }
  const H = (ix, r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 && ix.h.has(r * 8 + c);
  const V = (ix, r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 && ix.v.has(r * 8 + c);

  // Is the step from (r,c) in direction (dr,dc) blocked by a wall?
  function isBlocked(ix, r, c, dr, dc) {
    if (dr === 1) return H(ix, r, c) || H(ix, r, c - 1);
    if (dr === -1) return H(ix, r - 1, c) || H(ix, r - 1, c - 1);
    if (dc === 1) return V(ix, r, c) || V(ix, r - 1, c);
    return V(ix, r, c - 1) || V(ix, r - 1, c - 1);
  }

  function pawnMoves(s, p, ix) {
    ix = ix || wallIndex(s.walls);
    const me = s.pawns[p], op = s.pawns[1 - p], out = [];
    for (const [dr, dc] of DIRS) {
      const r = me.r + dr, c = me.c + dc;
      if (!inb(r, c) || isBlocked(ix, me.r, me.c, dr, dc)) continue;
      if (r === op.r && c === op.c) {
        const r2 = r + dr, c2 = c + dc;
        if (inb(r2, c2) && !isBlocked(ix, r, c, dr, dc)) {
          out.push({ r: r2, c: c2 });                       // straight jump
        } else {
          const side = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [er, ec] of side) {                    // diagonal jump
            const r3 = r + er, c3 = c + ec;
            if (inb(r3, c3) && !isBlocked(ix, r, c, er, ec)) out.push({ r: r3, c: c3 });
          }
        }
      } else out.push({ r, c });
    }
    return out;
  }

  // Shortest path length to goal row, ignoring pawns. 99 = no path.
  function dist(s, p, ix) {
    ix = ix || wallIndex(s.walls);
    const st = s.pawns[p], g = GOAL[p];
    if (st.r === g) return 0;
    const d = new Int8Array(81).fill(-1);
    const q = [st.r * 9 + st.c];
    d[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const cur = q[i], r = (cur / 9) | 0, c = cur % 9;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inb(nr, nc) || d[nr * 9 + nc] >= 0 || isBlocked(ix, r, c, dr, dc)) continue;
        d[nr * 9 + nc] = d[cur] + 1;
        if (nr === g) return d[nr * 9 + nc];
        q.push(nr * 9 + nc);
      }
    }
    return 99;
  }

  // Returns null when legal, otherwise an error string.
  function canWall(s, p, o, r, c) {
    if (o !== 'h' && o !== 'v') return 'Bad wall';
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 7 || c < 0 || c > 7) return 'Out of the board';
    if (s.left[p] <= 0) return 'No walls left';
    for (const w of s.walls) {
      if (w.r === r && w.c === c) return 'Walls cannot overlap';
      if (o === 'h' && w.o === 'h' && w.r === r && Math.abs(w.c - c) === 1) return 'Walls cannot overlap';
      if (o === 'v' && w.o === 'v' && w.c === c && Math.abs(w.r - r) === 1) return 'Walls cannot overlap';
    }
    const ix = wallIndex(s.walls.concat([{ o, r, c }]));
    if (dist(s, 0, ix) >= 99 || dist(s, 1, ix) >= 99) return 'You cannot fully block a path';
    return null;
  }

  function apply(s, p, a) {
    const bad = e => ({ ok: false, error: e });
    if (!a || typeof a !== 'object') return bad('Bad action');
    if (s.winner !== null) return bad('Game over');
    if (s.turn !== p) return bad('Not your turn');
    const n = JSON.parse(JSON.stringify(s));
    if (a.t === 'move') {
      if (!Number.isInteger(a.r) || !Number.isInteger(a.c)) return bad('Bad move');
      if (!pawnMoves(s, p).some(m => m.r === a.r && m.c === a.c)) return bad('Illegal move');
      n.pawns[p] = { r: a.r, c: a.c };
      if (a.r === GOAL[p]) n.winner = p;
    } else if (a.t === 'wall') {
      const e = canWall(s, p, a.o, a.r, a.c);
      if (e) return bad(e);
      n.walls.push({ o: a.o, r: a.r, c: a.c });
      n.left[p]--; n.used[p]++;
    } else return bad('Bad action');
    n.moves++;
    if (n.winner === null) n.turn = 1 - p;
    return { ok: true, state: n };
  }

  /* ---------------- AI ---------------- */
  function candidates(s, p) {
    const l = pawnMoves(s, p).map(m => ({ t: 'move', r: m.r, c: m.c }));
    if (s.left[p] > 0)
      for (const o of ['h', 'v'])
        for (let r = 0; r < 8; r++)
          for (let c = 0; c < 8; c++)
            if (!canWall(s, p, o, r, c)) l.push({ t: 'wall', o, r, c });
    return l;
  }
  function evalS(s, p) {
    if (s.winner === p) return 1e5;
    if (s.winner === 1 - p) return -1e5;
    const ix = wallIndex(s.walls);
    return (dist(s, 1 - p, ix) - dist(s, p, ix)) * 10 + (s.left[p] - s.left[1 - p]) * 0.7;
  }
  function aiMove(s, p, level) {
    level = level || 'medium';
    const noise = { easy: 14, medium: 3, hard: 0.001 }[level] || 3;
    const scored = candidates(s, p).map(a => {
      const st = apply(s, p, a).state;
      let sc = evalS(st, p);
      if (a.t === 'wall' && level === 'easy') sc -= 8;
      return { a, st, sc: sc + Math.random() * noise };
    });
    scored.sort((x, y) => y.sc - x.sc);
    if (level !== 'hard') return scored[0].a;
    let best = scored[0], bv = -Infinity;
    for (const x of scored.slice(0, 8)) {
      if (x.st.winner === p) return x.a;
      let worst = Infinity;
      for (const b of candidates(x.st, 1 - p)) {
        const v = evalS(apply(x.st, 1 - p, b).state, p);
        if (v < worst) { worst = v; if (worst < bv) break; }
      }
      if (worst > bv) { bv = worst; best = x; }
    }
    return best.a;
  }

  return { N, WALLS, GOAL, newState, pawnMoves, canWall, apply, dist, wallIndex, aiMove };
});
