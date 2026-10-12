# WallRush

Online multiplayer "block their way" board game (Quoridor-style). Reach the opposite side first; on your turn move your pawn **or** place one of your 10 walls.

Features: quick match, public rooms, play-with-friend via 5-letter code / invite link, vs AI (easy/medium/hard), daily + all-time rankings, win streaks, a daily quest (win with ≤3 walls = +40), 60s turn timer, and reconnect if a player's connection drops (30s grace).

## Run on your computer

```
npm install
npm start
```
Open http://localhost:3000 in two browser tabs (or two phones on the same Wi-Fi) and tap **Quick match**.

`npm test` plays a full game between two bots against a temporary server.

## Host it online (so anyone can play)

It needs a Node host that supports WebSockets. The easiest free-ish option is **Render**:

1. Put this folder on GitHub.
2. Render → New → Web Service → pick the repo.
3. Build command: `npm install`  Start command: `npm start`
4. Open the URL Render gives you and share it. HTTPS/WSS works automatically.

Railway, Fly.io, or any VPS (`npm start` behind Nginx/Caddy with WebSocket upgrade) work too.

### Keeping rankings
Player stats are saved to `data.json` (path can be changed with `DATA_FILE`). On free hosts the disk is wiped on every redeploy/sleep, so attach a persistent disk and set `DATA_FILE=/data/data.json`, or the rankings will reset.

### Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Server port |
| `TURN_SECONDS` | 60 | Time per turn before forfeit |
| `RESET_UTC_OFFSET_HOURS` | 1 | Daily ranking resets at midnight at this UTC offset (1 = Lagos) |
| `DATA_FILE` | ./data.json | Where stats are stored |

## Notes
- Players are anonymous guests (a random ID stored in the browser). They can change their display name in Profile. Add real accounts later if you want cheat-proof rankings.
- Ranked games (Quick match, Public rooms) give +25 per win. Friend-code games are unranked to prevent point farming.
- All rules are enforced on the server (`public/game.js` is shared by server and browser).
- Tip: on iPhone/Android use "Add to Home Screen" to get a full-screen app feel.
