// =====================================================================
//  THE WALKING CITY — every tunable number lives here.
//  Change a number, then re-run:  node walking-city/sim/simulate.js
//  Numbers marked [T] in the design doc map to the keys below.
// =====================================================================

export const RES = ['ore', 'fuel', 'power', 'part'];
export const BASICS = ['ore', 'fuel', 'power'];

// kind: extractor (needs nothing), refiner (turns inputs into resources),
//       engine (turns inputs into strides), action (one-shot effect).
// needs / makes are per round. Output goes to EVERY adjacent building in full.
export const CARDS = {
  // ---- Tier I (from round 1) ----
  orepit:    { name: 'Ore Pit',       tier: 1, kind: 'extractor', needs: {}, makes: { ore: 1 } },
  fuelwell:  { name: 'Fuel Well',     tier: 1, kind: 'extractor', needs: {}, makes: { fuel: 1 } },
  dynamo:    { name: 'Dynamo',        tier: 1, kind: 'extractor', needs: {}, makes: { power: 1 } },
  workshop:  { name: 'Workshop',      tier: 1, kind: 'refiner',   needs: { ore: 1, power: 1 }, makes: { part: 1 } },
  piston:    { name: 'Piston Engine', tier: 1, kind: 'engine',    needs: { fuel: 1, power: 1 }, makes: { stride: 1 } },
  overhaul:  { name: 'Overhaul',      tier: 1, kind: 'action',    needs: {}, makes: {}, text: 'Swap two of your tiles (either may be empty).' },
  // ---- Tier II (from round 4) ----
  deepmine:  { name: 'Deep Mine',     tier: 2, kind: 'extractor', needs: {}, makes: { ore: 2 } },
  refinery:  { name: 'Refinery',      tier: 2, kind: 'refiner',   needs: { ore: 1 }, makes: { fuel: 2 } },
  foundry:   { name: 'Foundry',       tier: 2, kind: 'refiner',   needs: { ore: 2, power: 1 }, makes: { part: 2 } },
  turbine:   { name: 'Turbine Engine', tier: 2, kind: 'engine',   needs: { fuel: 1, part: 1 }, makes: { stride: 3 } },
  // ---- Tier III (from round 7) ----
  geotap:    { name: 'Geo Tap',       tier: 3, kind: 'extractor', needs: {}, makes: { fuel: 1, power: 1 } },
  assembly:  { name: 'Assembly Hall', tier: 3, kind: 'refiner',   needs: { ore: 1, fuel: 1, power: 1 }, makes: { part: 3 } },
  strider:   { name: 'Strider Engine', tier: 3, kind: 'engine',   needs: { fuel: 2, part: 1 }, makes: { stride: 5 } },
};

export const CONFIG = {
  minPlayers: 3, maxPlayers: 5,
  // One fixed deck. Tier cards are shuffled in at the start of their unlock round.
  deck: {
    1: { orepit: 9, fuelwell: 10, dynamo: 10, workshop: 7, piston: 12, overhaul: 2 },
    2: { deepmine: 4, refinery: 5, foundry: 5, turbine: 10, overhaul: 2 },
    3: { geotap: 6, assembly: 4, strider: 9 },
  },
  tierUnlockRounds: { 1: 1, 2: 3, 3: 6 },   // [T]
  handSize: 5,                    // [T] hand is topped up to this (passed cards + reserve + draws)
  reserveMax: 1,                  // [T]
  crateCap: 4,                    // [T] max crates a player can hold
  scrapYield: { 1: 'supply', 2: 'part', 3: 'part' }, // scrapping a card gives one crate
  generosityYield: 1,             // [T] crates you get when a card you passed gets built...
  generosityKind: 'part',         // [T] ...and what kind
  giftOnly: true,                 // after round 1 you may only BUILD cards passed to you or your kept card
  starters: [{ card: 'dynamo', tile: 4 }, { card: 'fuelwell', tile: 6 }],  // every district starts with these (tile = row*3+col, row 0 touches the core)
  maxRounds: 10,                  // [T] hard cap; not at the Haven by then = lost
  havenPerPlayer: 24,             // [T] Haven distance = this x players
  stormStart: -6,                 // [T] storm starts this many strides behind
  // [T] storm speed per round, by player count. Index = round-1.
  stormSpeed: {
    3: [2, 3, 3, 4, 6, 10, 14, 17, 20, 23],
    4: [3, 4, 4, 6, 8, 11, 16, 21, 25, 29],
    5: [4, 5, 5, 8, 10, 15, 19, 25, 32, 36],
  },
  // Difficulty. First Voyage is the default for a new group.
  modes: {
    first:    { name: 'First Voyage', stormStart: -9, stormScale: 0.95 },
    standard: { name: 'Standard',     stormStart: -6, stormScale: 1 },
  },
  twistStartRound: 4,             // [T]
  storms: {
    lightning: { name: 'Lightning Storm', speedScale: 0.94, text: 'On odd rounds from round 5, every Power building outside your inner row (the row touching the core) is struck and shuts off.' },
    sandstorm: { name: 'Sandstorm', speedScale: 1.08, text: 'From round 4, one outer-row column in every district is buried each round (shown a round ahead).' },
  },
  // Main Drive stages: what each district must contribute, and the permanent strides per round once finished.
  stages: [
    { need: 1, res: 'part', bonus: { 3: 2, 4: 2, 5: 3 } },
    { need: 1, res: 'part', bonus: { 3: 2, 4: 3, 5: 4 } },
    { need: 2, res: 'part', bonus: { 3: 3, 4: 4, 5: 5 } },
    { need: 3, res: 'part', bonus: { 3: 4, 4: 6, 5: 7 } },
  ],
  playerColors: ['#ff6fae', '#a98bff', '#c8e04a', '#45d8e6', '#ffb36b'],
  resolveStepMs: 900,             // TV animation pace
};

export function cardsOfTier(t) { return Object.keys(CONFIG.deck[t] || {}); }
