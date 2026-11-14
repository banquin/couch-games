# Couch Games: Orbital Couriers (+ The Walking City)

One folder, one server, a game picker for the TV. Phones are the controllers.

**Orbital Couriers** is a 3–5 player couch game. The TV (or a laptop plugged into the TV) shows the star map. Each player joins on their phone by scanning a QR code and secretly programs 3 moves per round. The TV then flies every ship at once, step by step. About 20–30 minutes for 8 rounds.

## Play it tonight (recommended way: laptop + TV, same Wi-Fi)

1. **Install Node.js once.** Go to https://nodejs.org, download the "LTS" installer, and click through it.
2. **Get this folder** onto the laptop (download `couch-games.zip` from the project files and unzip it).
3. **Start the game.**
   - Mac: double-click `start-mac.command`. The first time, macOS may refuse; right-click it, choose **Open**, then **Open** again.
   - Windows: double-click `start-windows.bat`.
   - A black window opens and the game picker opens in your browser. Leave the black window open while you play.
   - Click **Host this game** on Orbital Couriers.
4. **Put the browser on the TV** (HDMI cable, or cast the tab) and make it full screen.
5. **Everyone scans the QR code** with their phone camera (phones must be on the same Wi-Fi as the laptop), types a name, and taps Join.
6. With 3–5 captains in, press **Launch**.

Want to try it alone first? Press **+ Practice bot** on the TV twice, then join with your phone.

If a phone can't connect: check it's on the same Wi-Fi (not cellular), and type the address shown under the QR code. Some office or hotel Wi-Fi blocks devices from seeing each other; home Wi-Fi is fine.

## Other way: host it online (no install, any network)

1. Go to https://app.netlify.com/drop and drag the whole `couch-games` folder onto the page (a free account keeps the link alive).
2. Open the link it gives you on the TV's browser and pick a game.
3. Phones scan the QR code from any network.

This mode connects phones through the free PeerJS service (peer-to-peer). It was tested with a local copy of the PeerJS server, not the public one, so if phones get stuck on "Connecting…", use the laptop way above.

## During the game

- **Someone's phone died or they stepped away?** On the TV, click **autopilot** on their row and a bot plays their turns. When they open their phone again, they get their ship back.
- **Pause** (or Space) freezes the flight animation. **New game** (click twice) goes back to the lobby.
- Refreshing the TV page or a phone is safe; the game picks up where it was.

## Changing the rules after a playtest

Every number lives in **`orbital-couriers/js/config.js`**: rounds, hand size, deck, upgrade costs, captains, contract points, and the star map itself (drawn as text, one character per space). Change it, save, refresh the TV page.

To see how a change affects balance before playtesting, run the simulator (needs Node) from the `orbital-couriers` folder in a terminal:

```
node sim/simulate.js 300        # 300 bot games at 3, 4 and 5 players, prints a balance report
node sim/shoptest.js 300 4      # does buying upgrades pay off? one shopper vs. balanced bots
node test/engine.test.js        # rules tests
```

## How it's built (and why)

- **Plain HTML/CSS/JavaScript, no build step, no npm install.** The fastest route to a living-room test; any computer with Node, or any static web host, can run it.
- **One shared server and connection layer for every game.** `server.js`, `shared/net.js` (transport), `shared/style.css` and `index.html` (the game picker, fed by `shared/games.js`) are shared. Each game is a folder with its own `host.html` (TV) and `play.html` (phone).
- **The rules are separate from the screens.** `orbital-couriers/js/engine/` is pure game logic (state in, action in, new state out). The TV (`js/ui/host.js`), the phones (`js/ui/phone.js`), the simulator (`sim/`) and the tests all use the same engine, so the rules can't drift apart.
- **The TV runs the game.** Phones only ever receive their own private view (their hand and plan), never anyone else's.
- **Networking is a dumb pipe** (`shared/net.js`): `server.js` relays messages on home Wi-Fi with zero dependencies; on a static host it falls back to PeerJS. `?net=local` runs everything in tabs of one browser for testing.

| File | What it is |
| --- | --- |
| `index.html`, `shared/games.js` | Game picker on the TV |
| `server.js`, `start-*.command/.bat` | Tiny local server + relay, and double-click starters |
| `shared/net.js` | Phone ↔ TV connection (relay, PeerJS, or tabs) |
| `orbital-couriers/js/config.js` | All Orbital Couriers rules and the map |
| `orbital-couriers/js/engine/` | Rules engine, movement, bots |
| `orbital-couriers/js/ui/` | TV screen, phone controller, star-map drawing |
| `orbital-couriers/sim/`, `orbital-couriers/test/` | Balance simulator, rules tests, browser end-to-end test |
| `walking-city/` | The Walking City (built in its own thread; see its README) |
