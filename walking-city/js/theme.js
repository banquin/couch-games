// Everything a player reads that names the world lives here, so the game can be re-themed
// (new story, same mechanics) by editing only this file. config.js merges these over its rules.
// Theme: Last Train Out (Brendan’s pick, 2026-11-14). The previous Walking City words are in git history.
export const THEME = {
  "title": [
    "Last Train",
    "Out"
  ],
  "tagline": "Five cars. One train. Outrun the wildfire to the last station.",
  "words": {
    "city": "train",
    "City": "Train",
    "storm": "wildfire",
    "Storm": "Wildfire",
    "haven": "Last Station",
    "strides": "miles",
    "stride": "mile",
    "lightning": "embers",
    "Lightning": "Embers",
    "strike": "ember",
    "strikes": "embers",
    "plates": "plates",
    "gears": "gears",
    "cores": "cores",
    "insight": "charts",
    "power": "steam",
    "ore": "ore",
    "route": "Line",
    "cover": "douse",
    "covers": "douses",
    "blueprint": "blueprint"
  },
  "depts": {
    "power": {
      "name": "Boiler",
      "short": "BLR",
      "blurb": "Balance the steam. Fireboxes heat slowly, Turbines overheat, and surplus blows a valve."
    },
    "fab": {
      "name": "Workshop",
      "short": "WRK",
      "blurb": "Ore → plates → gears → cores. Find the bottleneck and feed every car’s builds."
    },
    "loco": {
      "name": "Engine",
      "short": "ENG",
      "blurb": "Turn steam and gears into miles. Manage piston heat and pick the line."
    },
    "shield": {
      "name": "Armour",
      "short": "ARM",
      "blurb": "Only you see where the embers will land. Decide what survives."
    },
    "research": {
      "name": "Map Room",
      "short": "MAP",
      "blurb": "Draw charts, buy upgrades only you can see, boost whoever is short. You also see the track ahead."
    }
  },
  "machines": {
    "reactor": {
      "name": "Firebox",
      "text": "Steady steam. The setting moves only a little each round, and a lit Firebox can’t drop below half."
    },
    "turbine": {
      "name": "Turbine",
      "text": "Fast steam. Above half output it runs Hot and is capped at half next round."
    },
    "capacitor": {
      "name": "Steam Tank",
      "text": "Stores leftover steam and covers shortfalls automatically."
    },
    "cooler": {
      "name": "Condenser",
      "text": "Adjacent Fireboxes heat +1 faster; adjacent Turbines never run Hot."
    },
    "drill": {
      "name": "Ore Hopper",
      "text": "Scoops ore. Ore can’t be stored."
    },
    "smelter": {
      "name": "Smelter",
      "text": "Ore → plates 1:1. +2 per adjacent Ore Hopper."
    },
    "press": {
      "name": "Press",
      "text": "2 plates → 1 gear (for the Engine). +1 per adjacent Smelter."
    },
    "assembler": {
      "name": "Assembler",
      "text": "Gear + plate → 1 core (for the Map Room). +1 per adjacent Press."
    },
    "engine": {
      "name": "Piston",
      "text": "Throttle T0–T3 uses 0/1/2/3 steam and adds 0/0/1/3 heat. T3 burns a gear."
    },
    "radiator": {
      "name": "Radiator",
      "text": "Adjacent Pistons shed extra heat each round."
    },
    "gearbox": {
      "name": "Gearbox",
      "text": "Adjacent Pistons +1 mile at T2, +2 at T3."
    },
    "projector": {
      "name": "Water Cannon",
      "text": "A Water Cannon in your column X douses column X of other cars. Refills if steamed."
    },
    "armory": {
      "name": "Sand Bin",
      "text": "Turns 2 plates into a one-use douse for any column."
    },
    "radar": {
      "name": "Lookout",
      "text": "You also see next round’s ember columns."
    },
    "lab": {
      "name": "Chart Desk",
      "text": "Steam → charts. +1 next to an Analyzer."
    },
    "analyzer": {
      "name": "Analyzer",
      "text": "Each core → 4 charts."
    },
    "uplink": {
      "name": "Telegraph",
      "text": "Sends Boosts (2 charts each). Keeps adjacent Upgrades online."
    },
    "module": {
      "name": "Upgrade",
      "text": "An upgrade for the whole train. Online while steamed, not jammed and next to a working Telegraph."
    }
  },
  "techs": {
    "deepcells": {
      "name": "Deep Tanks",
      "text": "Steam Tanks store +3."
    },
    "fastramp": {
      "name": "Forced Draft",
      "text": "Fireboxes change +2 more per round."
    },
    "finepress": {
      "name": "Fine Press",
      "text": "Gears cost 1 plate."
    },
    "directfeed": {
      "name": "Direct Feed",
      "text": "Workshop adjacency bonuses doubled."
    },
    "heatsinks": {
      "name": "Heat Sinks",
      "text": "Piston heat cap 6."
    },
    "geartrains": {
      "name": "Gear Trains",
      "text": "T3 burns no gear."
    },
    "widebeam": {
      "name": "Wide Nozzles",
      "text": "Every Water Cannon douses +1 more."
    },
    "stormchart": {
      "name": "Fire Map",
      "text": "Everyone sees this round’s ember columns."
    },
    "rapidrefit": {
      "name": "Quick Couplings",
      "text": "Every car gets 3 free moves a round."
    },
    "prefab": {
      "name": "Prefab",
      "text": "Builds and upgrades cost 1 plate less."
    }
  },
  "terrain": {
    "flats": {
      "name": "Straight Run",
      "text": "Fast track: miles ×1.25."
    },
    "hardpan": {
      "name": "Prairie",
      "text": "Plain track."
    },
    "orefield": {
      "name": "Mining Spur",
      "text": "Every Ore Hopper scoops +2 ore."
    },
    "vents": {
      "name": "Hot Springs",
      "text": "The Boiler gets 6 free steam."
    },
    "scrapyard": {
      "name": "Junk Siding",
      "text": "Every car picks up 2 plates."
    }
  },
  "overclock": {
    "power": "Boiler +5 steam",
    "fab": "Workshop +4 ore, +2 smelting",
    "loco": "Engine +20% miles",
    "shield": "Armour +2 douses (any column)"
  },
  "modes": {
    "first": {
      "name": "First Run"
    },
    "standard": {
      "name": "Standard"
    },
    "gale": {
      "name": "Inferno"
    }
  },
  "lose": {
    "caught": "The wildfire caught the train",
    "timeout": "Out of time before the Last Station"
  },
  "win": "The train made the Last Station"
};
