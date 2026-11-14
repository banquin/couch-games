// =====================================================================
//  ORBITAL COURIERS — RULES CONFIG
//  Every tunable number in the game lives here. Change a value, save,
//  and refresh the TV page. Run `node sim/simulate.js` to see how a
//  change affects balance before you playtest it.
// =====================================================================

export const CONFIG = {
  rounds: 8,                 // game length
  movesPerRound: 3,          // cards each player programs per round
  handSize: 5,               // cards drawn each round (before upgrades)
  startingCredits: 4,         // enough for one upgrade in the first shop
  startingHold: 2,           // contract slots before upgrades

  // Starting deck (every player gets the same). Card types: burn1, burn2, burn3, drift, brake
  deck: { burn1: 3, burn2: 3, burn3: 2, drift: 1, brake: 2 },

  slingshotBonus: 1,         // extra spaces for a Burn that starts on any well space
  // false = cargo is claimed when someone picks it up (simpler, fewer wasted trips).
  // true  = the original doc rule: anyone can load it, first DELIVERY wins, others get salvage.
  sharedCargo: false,
  salvageCredits: 1,         // credits for selling a rival-delivered cargo at any planet
  contractsOpen: 2,          // contracts available to pick up = players + this number
  ageCap: 2,                 // an unclaimed contract gains +1 point each round, up to this many
  creditsPerEndPoint: 4,     // at game end, every 4 unspent credits = 1 point (0 = off)
  bumpFollow: true,          // after bumping a ship, you slide into the space it left
  minPoints: 2,              // contract points = max(minPoints, ceil(distance / pointsDivisor))
  pointsDivisor: 3,
  creditsPerPoint: 1,        // a delivery pays its points AND this many credits per point

  // Turn order is automatic each round: lowest score moves first in every step.

  // Upgrades: cost per level (index 0 = level 1). Remove a level to cap it.
  upgrades: {
    hold:  { name: 'Cargo hold',     desc: '+1 cargo slot',                       cost: [5, 8] },
    hand:  { name: 'Extra card',     desc: '+1 card in your hand every round',    cost: [3, 6] },
    boost: { name: 'Afterburner',    desc: 'Upgrade a Burn 1 in your deck to a Burn 3', cost: [2, 4] },
  },

  // Captains are dealt at random, one per player.
  captains: {
    ghost:   { name: 'Ghost',   desc: 'Your first move each round ignores gravity.' },
    bulwark: { name: 'Bulwark', desc: 'You can never be bumped.' },
    hauler:  { name: 'Hauler',  desc: 'Cargo hold upgrades cost 3 less.', discount: { hold: 3 } },
    broker:  { name: 'Broker',  desc: 'Every delivery pays +1 credit, and you see the next contract.' },
    tug:     { name: 'Tug',     desc: 'Your bumps push ships 2 spaces.' },
  },

  // ---- The star map ----------------------------------------------------
  // One character per space, 12 x 12.
  //   .  empty space          K V E N T J  planets (see `planets` below)
  //   o  gravity-well ring    @  well core (passable; ring spaces pull toward it)
  //   1-5  ship start spaces  #  closed space (blocked)
  //   x  closed only in 3-player games
  map: [
    '. . . . . . . . . . . .',
    '. . . . . . . 1 . . V .',
    '. K . o o o . . . . . .',
    '. . . o @ o . . . . . .',
    '. . . o o o . . . . . 3',
    '2 . . . . . E . . . . .',
    '. . . . . . . o o o . .',
    '. . . . . . . o @ o . .',
    '. . . . . . . o o o . .',
    '. N . . . . . . . x x x',
    '. . . . . T . . . x J x',
    '. . 5 . . . . . 4 x x x',
  ],
  planets: {
    K: { name: 'Kell',  color: '#7fd1ff' },
    V: { name: 'Vos',   color: '#ff9b6a' },
    E: { name: 'Ember', color: '#ffcf4a' },
    N: { name: 'Nyx',   color: '#b48cff' },
    T: { name: 'Tarn',  color: '#7be0a5' },
    J: { name: 'Juno',  color: '#ff7fb8' },
  },
  wellNames: ['The Maw', 'The Sink'],
  cargoTypes: ['Ice', 'Ore', 'Spores', 'Relics', 'Plasma', 'Silk', 'Medics', 'Glass'],

  // TV pacing
  resolveStepMs: 650,        // pause between ship moves on the TV
  playerColors: ['#ff4757', '#1e90ff', '#ff9f1a', '#2ed573', '#f368e0'],  // saturated, so ships stand out from the pastel planets
};

// Cards (fixed definitions; counts live in CONFIG.deck)
export const CARDS = {
  burn1: { label: 'Burn 1', short: '1', dist: 1, dir: true },
  burn2: { label: 'Burn 2', short: '2', dist: 2, dir: true },
  burn3: { label: 'Burn 3', short: '3', dist: 3, dir: true },
  drift: { label: 'Drift',  short: '~', dist: 0, dir: false },
  brake: { label: 'Brake',  short: 'B', dist: 1, dir: true, noGravity: true },
};
