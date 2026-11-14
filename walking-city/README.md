# Last Train Out (folder: walking-city)

A co-op game for exactly five cars, played by 1–5 people with bots running any car nobody picks. It takes about 30–40 minutes. The TV shows the train: five cars, each with a 4×4 grid of machines, and a race track on the left where the wildfire chases the train to the Last Station. Each phone runs one car.

Rules and design: `walking-city-design-doc.md` in the project files (v0.3 matches this build; the doc still uses the older Walking City names).

## The five cars

| Car | Engine id | What you do |
|---|---|---|
| Boiler | `power` | Set Fireboxes and Turbines, pledge steam to every other car, and avoid surplus. |
| Workshop | `fab` | Run ore, plates, gears and cores, and send plates to whoever is building. |
| Engine | `loco` | Set piston throttles against heat, pick the line at each fork, and ask for gears. |
| Armour | `shield` | Only you see where embers land, so you choose what gets doused. |
| Map Room | `research` | Make charts, send blueprints that unlock upgrade levels, boost cars, and install upgrades. You also see the next fork. |

## Play it

1. Open the live site (or run `node server.js` from the `couch-games` folder) and click **Host** on this game. Put that browser on the TV.
2. Everyone scans the QR code, types a name, and picks a car. Bots take the rest.
3. Pick a difficulty. **First Run** is the easiest.
4. Press **Start**.

### A round, from your phone
- Tap an empty cell to **build** (one build or upgrade a round). Tap a machine to set its dial, **upgrade** it, **repair** it, or **move** it. The first move is free; machines moved after that sit idle for the round.
- The strip at the top shows what you're asking for and what's been pledged to you. Asks are computed from your plan, so you never have to type them.
- Use your car's panel for your role: pledges, the recipe, the line, the ember map, or blueprints.
- Tap **Ready**. **Autopilot** fills in a sensible plan for you to check.

The TV then plays the round in beats (embers, Boiler, Workshop, Armour and Map Room, Engine, wildfire) and shows one line explaining what cost the most miles.

## Code layout

- `js/config.js`: every rule number. `js/theme.js`: every name and word players read. Re-theme the game by editing only theme.js.
- `js/engine/engine.js`: pure rules (no DOM). `bots.js`: the bot planner for any car. `views.js`: what the TV and each phone may see.
- `js/ui/icons.js` + `js/ui/board.js`: all drawing. A new art style (e.g. 3D) replaces these two files.
- `js/ui/host.js` (TV) and `js/ui/phone.js` (phone): screens and networking.

## Tests

- `node walking-city/test/engine.test.js`: rules tests.
- `node walking-city/sim/simulate.js 150 standard roles`: bot games, win rates, and what happens when a seat is played badly.
- `node server.js` then `node walking-city/test/smoke.cjs <outDir>`: a headless TV and two phones for three rounds, with screenshots.
