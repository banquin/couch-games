// The Walking City v0.3 — every rule number lives here. [T] = tunable after playtests.
// Five departments, each with a 4×4 grid (cell = row*4 + col; columns A–D are strike lanes).

export const DEPTS = ['power', 'fab', 'loco', 'shield', 'research'];

export const DEPT_INFO = {
  power:    { name: 'Power',       short: 'PWR', color: '#ffb02e', difficulty: 3, blurb: 'Balance the grid. Reactors ramp slowly, Turbines overheat, and surplus trips a generator.' },
  fab:      { name: 'Fabrication', short: 'FAB', color: '#4aa8ff', difficulty: 3, blurb: 'Ore → plates → gears → cores. Find the bottleneck and feed everyone\'s builds.' },
  loco:     { name: 'Locomotion',  short: 'LOC', color: '#ff5a4e', difficulty: 1, blurb: 'Turn power and gears into strides. Manage engine heat and pick the route.' },
  shield:   { name: 'Shielding',   short: 'SHD', color: '#5cf2a8', difficulty: 1, blurb: 'Only you see where lightning will strike. Decide what survives.' },
  research: { name: 'Research',    short: 'RES', color: '#c58bff', difficulty: 2, blurb: 'Make insight, buy techs only you can see, overclock whoever is short. You also see the road ahead.' },
};

// Values in arrays are per level [L1, L2, L3]. A machine's levels = length of its arrays (no array = 1 level).
// draw = power it needs to run. pri = power priority inside its department (lower runs first when short).
export const MACHINES = {
  // Power (its machines need no power)
  reactor:   { dept: 'power', name: 'Reactor',   cost: 4, levels: 3, max: [6, 9, 12], ramp: [2, 3, 4], text: 'Steady power. The setpoint moves only a little each round, and a running Reactor can\'t go below half.' },
  turbine:   { dept: 'power', name: 'Turbine',   cost: 2, levels: 2, max: [5, 7], text: 'Fast power. Above half output it runs Hot and is capped at half next round.' },
  capacitor: { dept: 'power', name: 'Capacitor', cost: 2, levels: 2, store: [4, 7], text: 'Stores leftover power and covers shortfalls automatically.' },
  cooler:    { dept: 'power', name: 'Cooler',    cost: 3, levels: 1, text: 'Adjacent Reactors ramp +1; adjacent Turbines never run Hot.' },
  // Fabrication
  drill:     { dept: 'fab', name: 'Drill',     cost: 2, levels: 2, draw: 1, pri: 0, out: [4, 6], text: 'Mines ore. Ore can\'t be stored.' },
  smelter:   { dept: 'fab', name: 'Smelter',   cost: 2, levels: 2, draw: 1, pri: 1, out: [3, 5], bonus: 'drill', text: 'Ore → plates 1:1. +2 per adjacent Drill.' },
  press:     { dept: 'fab', name: 'Press',     cost: 3, levels: 2, draw: 1, pri: 2, out: [1, 2], bonus: 'smelter', text: '2 plates → 1 gear (for Locomotion). +1 per adjacent Smelter.' },
  assembler: { dept: 'fab', name: 'Assembler', cost: 4, levels: 2, draw: 2, pri: 3, out: [1, 2], bonus: 'press', text: 'Gear + plate → 1 core (for Research). +1 per adjacent Press.' },
  // Locomotion
  engine:    { dept: 'loco', name: 'Engine',    cost: 4, levels: 3, strides: [[0, 2, 4, 7], [0, 3, 6, 10], [0, 4, 8, 13]], text: 'Throttle T0–T3 uses 0/1/2/3 power and adds 0/0/1/3 heat. T3 burns a gear.' },
  radiator:  { dept: 'loco', name: 'Radiator',  cost: 2, levels: 2, cool: [1, 2], text: 'Adjacent Engines shed extra heat each round.' },
  gearbox:   { dept: 'loco', name: 'Gearbox',   cost: 3, levels: 1, draw: 1, pri: 9, text: 'Adjacent Engines +1 stride at T2, +2 at T3.' },
  // Shielding
  projector: { dept: 'shield', name: 'Projector', cost: 3, levels: 2, draw: 1, pri: 0, out: [1, 2], text: 'A Projector in your column X makes covers for column X of other departments. Recharges if powered.' },
  armory:    { dept: 'shield', name: 'Armory',    cost: 2, levels: 2, out: [1, 2], text: 'Turns 2 plates into a one-use cover for any lane.' },
  radar:     { dept: 'shield', name: 'Radar',     cost: 3, levels: 1, draw: 1, pri: 1, text: 'You also see next round\'s strike lanes.' },
  // Research
  lab:       { dept: 'research', name: 'Lab',      cost: 2, levels: 3, draw: [2, 2, 3], pri: 1, out: [3, 5, 7], text: 'Power → insight. +1 next to an Analyzer.' },
  analyzer:  { dept: 'research', name: 'Analyzer', cost: 3, levels: 2, draw: 1, pri: 0, out: [1, 2], text: 'Each core → 4 insight.' },
  uplink:    { dept: 'research', name: 'Uplink',   cost: 3, levels: 2, draw: 1, pri: 2, out: [1, 2], text: 'Fires Overclocks (2 insight each). Keeps adjacent Modules online.' },
  module:    { dept: 'research', name: 'Module',   cost: 0, levels: 1, draw: 1, pri: 3, buildable: false, text: 'A tech for the whole city. Online while powered, unjammed and next to a powered Uplink.' },
};

export const UPGRADE_COST = [0, 3, 5];      // [T] cost to reach level 2, level 3
export const HEAT_CAP = 4;                  // [T]
export const THROTTLE = { draw: [0, 1, 2, 3], heat: [0, 0, 1, 3] };
export const ARMORY_PLATES = 2;             // [T] plates per Armory cover

export const TECHS = {
  deepcells:  { theme: 'power',  tier: 1, name: 'Deep Cells',   text: 'Capacitors store +3.' },
  fastramp:   { theme: 'power',  tier: 2, name: 'Fast Ramp',    text: 'Reactors ramp +2 per round.' },
  finepress:  { theme: 'fab',    tier: 1, name: 'Fine Press',   text: 'Gears cost 1 plate.' },
  directfeed: { theme: 'fab',    tier: 2, name: 'Direct Feed',  text: 'Fab adjacency bonuses doubled.' },
  heatsinks:  { theme: 'loco',   tier: 1, name: 'Heat Sinks',   text: 'Engine heat cap 6.' },
  geartrains: { theme: 'loco',   tier: 2, name: 'Gear Trains',  text: 'T3 burns no gear.' },
  widebeam:   { theme: 'shield', tier: 1, name: 'Wide Beam',    text: 'Every Projector makes +1 cover.' },
  stormchart: { theme: 'shield', tier: 2, name: 'Storm Chart',  text: 'Everyone sees this round\'s strike lanes.' },
  rapidrefit: { theme: 'city',   tier: 1, name: 'Rapid Refit',  text: 'Every department gets 3 free moves a round.' },
  prefab:     { theme: 'city',   tier: 2, name: 'Prefab',       text: 'Builds and upgrades cost 1 plate less.' },
};
export const TECH_COST = [0, 6, 8];         // [T] by tier
// Blueprints: Research unlocks the next machine level for a whole department (no grid space needed).
// UNLOCKS[dept][k] = insight to unlock level k+2.
export const UNLOCKS = { power: [4, 8], fab: [4], loco: [4, 8], shield: [4], research: [3, 6] }; // [T]
export const TECH_UNLOCK = { 1: 1, 2: 3 };  // round each tier appears
export const SHELF_SIZE = 3;

export const OVERCLOCK = {
  cost: 2,
  power:  { text: 'Power +5' },
  fab:    { text: 'Fab +4 ore, +2 smelting' },
  loco:   { text: 'Locomotion +20% distance' },
  shield: { text: 'Shield +2 covers (any lane)' },
};

export const TERRAIN = {
  flats:     { name: 'Salt Flats', grade: 1.25, text: 'Fast ground: strides ×1.25.' },
  hardpan:   { name: 'Hardpan',    grade: 1.0,  text: 'Plain ground.' },
  orefield:  { name: 'Ore Field',  grade: 1.0,  ore: 2, text: 'Every Drill mines +2 ore.' },
  vents:     { name: 'Vents',      grade: 1.0,  power: 6, text: 'Power gets 6 free power.' },
  scrapyard: { name: 'Scrapyard',  grade: 1.0,  plates: 2, text: 'Every department picks up 2 plates.' },
};
export const FAST_TERRAIN = ['flats', 'flats', 'hardpan'];
export const RICH_TERRAIN = ['orefield', 'vents', 'scrapyard'];

export const CONFIG = {
  rounds: 8,                                   // [T]
  startPlates: 4,                              // [T] every department
  salvage: 0,                                  // [T] plates every department salvages each round
  startInsight: 6,
  caps: { plates: 8, gears: 4, cores: 3, insight: 15 }, // [T]
  freeMoves: 1,                                // [T] moves per round that don't idle the machine
  surgeAt: 3,                                  // [T] leftover power after Capacitors that trips a generator
  repairCost: 1,
  jam: 1,                                      // [T] rounds a strike jams a lane's machines (1 = this round only)
  stormSpeed: [9, 14, 20, 26, 32, 38, 45, 52], // [T] Standard
  strikes:    [1, 2, 2, 3, 3, 4, 5, 6],        // [T] of 20 lanes
  auxPower: 1,                                 // [T] every department's own backup cell: 1 power a round
  modes: {
    first:    { name: 'First Voyage', haven: 150, stormStart: -15, stormScale: 0.9,  strikeAdj: -1 },
    standard: { name: 'Standard',     haven: 175, stormStart: -15, stormScale: 1.0,  strikeAdj: 0 },
    gale:     { name: 'Gale',         haven: 185, stormStart: -12, stormScale: 1.05, strikeAdj: 1 },
  },
  // Starting layouts: [type, cell, extra state]
  starts: {
    power:    [['reactor', 5, { set: 3 }], ['turbine', 6, { set: 2 }], ['capacitor', 9, { store: 2 }]],
    fab:      [['drill', 4], ['smelter', 5], ['smelter', 6], ['drill', 7], ['press', 9]],
    loco:     [['engine', 5, { throttle: 2 }], ['radiator', 6], ['engine', 7, { throttle: 2 }]],
    shield:   [['projector', 5, { charged: true }], ['armory', 6]],
    research: [['lab', 5], ['uplink', 6]],
  },
};

// ---- names and descriptions come from theme.js (swap that file to re-theme the game) ----
import { THEME } from './theme.js';
for (const [k, v] of Object.entries(THEME.depts)) Object.assign(DEPT_INFO[k], v);
for (const [k, v] of Object.entries(THEME.machines)) Object.assign(MACHINES[k], v);
for (const [k, v] of Object.entries(THEME.techs)) Object.assign(TECHS[k], v);
for (const [k, v] of Object.entries(THEME.terrain)) Object.assign(TERRAIN[k], v);
for (const [k, v] of Object.entries(THEME.overclock)) OVERCLOCK[k].text = v;
for (const [k, v] of Object.entries(THEME.modes)) Object.assign(CONFIG.modes[k], v);
