# The Walking City

Co-op factory game for 3–5 players, about 45 minutes. The TV shows the city: one 3×3 factory district per player, bolted around a shared Main Drive, with a storm chasing it up the track on the left. Each player's phone is their private hand. Everyone plans at the same time, then the TV runs the factory and the city walks.

Rules and design: `walking-city-design-doc.md` in the project files (v0.2 matches this build).

## Play it

It runs from the same `couch-games` folder and server as Orbital Couriers.

1. Start the server: double-click `start-mac.command` (Mac) or `start-windows.bat` (Windows). The game picker opens in your browser.
2. Click **Host this game** on **The Walking City**. Put that browser on the TV, full screen.
3. Everyone scans the QR code with their phone (same Wi-Fi), types a name, and taps **Join**.
4. Pick a storm (Lightning or Sandstorm) and a difficulty. **First Voyage** is the easier one; start there.
5. With 3–5 players, press **Start**.

Want to try it alone? Press **+ Practice bot** twice, then join with your phone.

### A round, from your phone
1. Tap a card, then choose what to do with it: **Build** (then tap a tile), **Scrap** for a crate, **Pass left**, **Pass right**, or **Keep**.
2. You must play one card and pass one each way. From round 2, you can only build cards that were passed to you (coloured border) or the one you kept.
3. Optionally send a crate to the Main Drive.
4. Tap **Ready**. Changed your mind? Tap **Change my plan** until everyone is ready.

The TV then plays the round: belts light up, starved machines flash red, Parts dock into the core, and the city and storm move. A short recap on the right explains what happened, and the next round starts on its own.

### During the game
- **Autopilot** on a player's row lets a bot plan for them; opening their phone again gives control back.
- **Pause** freezes the animation. **New game** (click twice) returns to the lobby.
- Refreshing the TV or a phone is safe.

## Change the numbers

Every rule number is in `js/config.js`: hand size, deck, card recipes, storm speed table, Haven distance, Drive stages, difficulty modes. Save and refresh the TV.

Check balance before a playtest (needs Node, run from the `couch-games` folder):

```
node walking-city/sim/simulate.js 200                 # bot games at 3/4/5 players, First Voyage, both storms
MODE=standard node walking-city/sim/simulate.js 200   # same, Standard difficulty
node --test walking-city/test/engine.test.js          # rules tests
```

`test/smoke.cjs` is a headless-browser end-to-end test (TV + phone + bots, needs Playwright): start the server, then `BOTS=2 ROUNDS=10 node walking-city/test/smoke.cjs shots/`.

## How it's built

- `js/engine/` is pure game logic: rules, flow, bots, and the views each screen gets. The TV, phones, simulator and tests all use it.
- `js/ui/host.js` (TV) runs the game; `js/ui/phone.js` is the controller. Phones only ever see their own hand.
- `js/ui/art.js` and `js/ui/ring.js` draw all art in code (SVG): machines, belts, the core.
- Networking is the shared `../shared/net.js`.
