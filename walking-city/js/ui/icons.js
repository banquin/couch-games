// All art is drawn in code here, so a renderer swap (e.g. 3D) only replaces this file and the board drawers.
// machineSvg(type, color) → SVG markup in a 100×100 box. resIcon(res, size) → inline <svg>.
const S = '#0b1220';   // dark ink
const L = '#e8f0ff';   // light metal

const parts = {
  reactor: c => `<circle cx="50" cy="50" r="34" fill="${S}" stroke="${c}" stroke-width="6"/>
    <g class="spin slow"><path d="M50 22 A28 28 0 0 1 74 36 L60 44 A12 12 0 0 0 50 38Z M74 64 A28 28 0 0 1 50 78 L50 62 A12 12 0 0 0 60 56Z M26 64 A28 28 0 0 1 26 36 L40 44 A12 12 0 0 0 40 56Z" fill="${c}"/></g>
    <circle cx="50" cy="50" r="8" fill="${L}" class="pulse"/>`,
  turbine: c => `<circle cx="50" cy="50" r="36" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g class="spin fast"><path d="M50 50 L50 18 Q64 26 54 48Z M50 50 L78 62 Q66 74 52 56Z M50 50 L22 64 Q20 46 46 50Z" fill="${L}"/></g>
    <circle cx="50" cy="50" r="6" fill="${c}"/>`,
  capacitor: c => `<rect x="28" y="16" width="44" height="70" rx="8" fill="${S}" stroke="${c}" stroke-width="5"/>
    <rect x="40" y="9" width="20" height="9" rx="2" fill="${c}"/>
    <rect x="35" y="56" width="30" height="10" fill="${c}"/><rect x="35" y="43" width="30" height="10" fill="${c}" opacity=".7"/><rect x="35" y="30" width="30" height="10" fill="${c}" opacity=".35"/>`,
  cooler: c => `<rect x="16" y="16" width="68" height="68" rx="10" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g stroke="${L}" stroke-width="5" stroke-linecap="round"><path d="M50 26 V74 M29 38 L71 62 M29 62 L71 38"/></g>
    <g stroke="${c}" stroke-width="4" stroke-linecap="round"><path d="M44 30 L50 36 L56 30 M44 70 L50 64 L56 70"/></g>`,
  drill: c => `<rect x="20" y="14" width="60" height="22" rx="5" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g class="rock"><path d="M34 38 H66 L50 86Z" fill="${L}" stroke="${S}" stroke-width="3"/><path d="M40 50 H60 M44 62 H56" stroke="${c}" stroke-width="4"/></g>`,
  smelter: c => `<path d="M20 84 V40 L36 24 H64 L80 40 V84Z" fill="${S}" stroke="${c}" stroke-width="5"/>
    <rect x="36" y="52" width="28" height="22" rx="4" fill="#ff7a2e" class="pulse"/><path d="M44 52 Q50 38 56 52" fill="#ffd36b"/>
    <rect x="58" y="10" width="10" height="18" fill="${c}"/>`,
  press: c => `<rect x="18" y="14" width="64" height="14" rx="3" fill="${c}"/>
    <g class="pump"><rect x="42" y="26" width="16" height="24" fill="${L}"/><rect x="28" y="48" width="44" height="12" rx="3" fill="${L}"/></g>
    <rect x="22" y="70" width="56" height="14" rx="3" fill="${S}" stroke="${c}" stroke-width="4"/>`,
  assembler: c => `<rect x="14" y="14" width="72" height="72" rx="12" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g class="spin slow"><path d="${gearPath(50, 50, 22, 14, 8)}" fill="${L}"/></g><circle cx="50" cy="50" r="6" fill="${c}"/>`,
  engine: c => `<rect x="24" y="12" width="52" height="46" rx="8" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g class="pump"><rect x="40" y="20" width="20" height="26" rx="3" fill="${L}"/></g>
    <path d="M30 58 L22 88 M70 58 L78 88 M44 58 L40 88 M56 58 L60 88" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,
  radiator: c => `<rect x="16" y="20" width="68" height="60" rx="6" fill="${S}" stroke="${c}" stroke-width="5"/>
    <g fill="${L}"><rect x="26" y="28" width="6" height="44"/><rect x="38" y="28" width="6" height="44"/><rect x="50" y="28" width="6" height="44"/><rect x="62" y="28" width="6" height="44"/></g>`,
  gearbox: c => `<g class="spin slow"><path d="${gearPath(38, 44, 20, 13, 8)}" fill="${L}"/></g>
    <g class="spin slow rev"><path d="${gearPath(64, 64, 16, 10, 7)}" fill="${c}"/></g><circle cx="38" cy="44" r="5" fill="${S}"/><circle cx="64" cy="64" r="4" fill="${S}"/>`,
  projector: c => `<path d="M24 84 L50 54 L76 84Z" fill="${S}" stroke="${c}" stroke-width="5"/>
    <ellipse cx="50" cy="36" rx="26" ry="14" fill="${S}" stroke="${L}" stroke-width="5"/><circle cx="50" cy="36" r="6" fill="${c}" class="pulse"/>
    <path d="M30 18 Q50 4 70 18" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  armory: c => `<path d="M50 12 L82 24 V48 Q82 74 50 88 Q18 74 18 48 V24Z" fill="${S}" stroke="${c}" stroke-width="5"/>
    <path d="M50 26 V74 M34 44 H66" stroke="${L}" stroke-width="6" stroke-linecap="round"/>`,
  radar: c => `<path d="M20 70 A40 40 0 0 1 80 70" fill="none" stroke="${c}" stroke-width="5"/>
    <g class="spin"><path d="M50 70 L50 30" stroke="${L}" stroke-width="5" stroke-linecap="round"/></g>
    <circle cx="50" cy="70" r="7" fill="${L}"/><rect x="30" y="76" width="40" height="10" rx="3" fill="${c}"/>`,
  lab: c => `<path d="M40 14 H60 M44 14 V40 L22 80 Q20 86 26 86 H74 Q80 86 78 80 L56 40 V14" fill="${S}" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M30 70 H70 L76 82 H24Z" fill="${c}" class="pulse"/><circle cx="46" cy="60" r="4" fill="${L}"/><circle cx="56" cy="52" r="3" fill="${L}"/>`,
  analyzer: c => `<circle cx="44" cy="44" r="24" fill="${S}" stroke="${c}" stroke-width="6"/><path d="M62 62 L84 84" stroke="${L}" stroke-width="9" stroke-linecap="round"/>
    <path d="M32 46 L40 38 L48 50 L56 40" fill="none" stroke="${L}" stroke-width="4"/>`,
  uplink: c => `<path d="M50 30 L32 88 M50 30 L68 88 M38 66 H62 M42 52 H58" stroke="${c}" stroke-width="5" fill="none"/>
    <circle cx="50" cy="26" r="8" fill="${L}" class="pulse"/><path d="M30 14 Q50 0 70 14 M36 22 Q50 12 64 22" fill="none" stroke="${L}" stroke-width="4" stroke-linecap="round"/>`,
  module: c => `<rect x="24" y="24" width="52" height="52" rx="6" fill="${S}" stroke="${c}" stroke-width="5"/>
    <rect x="38" y="38" width="24" height="24" fill="${c}" class="pulse"/>
    <path d="M32 16 V24 M50 16 V24 M68 16 V24 M32 76 V84 M50 76 V84 M68 76 V84 M16 32 H24 M16 50 H24 M16 68 H24 M76 32 H84 M76 50 H84 M76 68 H84" stroke="${L}" stroke-width="4"/>`,
};
function gearPath(cx, cy, R, r, n) {
  let d = '';
  for (let k = 0; k < n * 2; k++) {
    const a0 = (k / (n * 2)) * Math.PI * 2, a1 = ((k + 1) / (n * 2)) * Math.PI * 2;
    const rad = k % 2 ? r : R;
    d += (k ? 'L' : 'M') + (cx + rad * Math.cos(a0)).toFixed(1) + ' ' + (cy + rad * Math.sin(a0)).toFixed(1) + ' L' + (cx + rad * Math.cos(a1)).toFixed(1) + ' ' + (cy + rad * Math.sin(a1)).toFixed(1) + ' ';
  }
  return d + 'Z';
}
export function machineSvg(type, color) { return (parts[type] || parts.module)(color || '#8aa'); }

export const RES_COLOR = { power: '#ffd23e', plates: '#b8c4d6', gears: '#e3a35a', cores: '#c58bff', insight: '#7ef3ff', ore: '#c76b47', strides: '#5cf2a8' };
const resPaths = {
  power: '<path d="M13 2 L4 13 H11 L9 22 L20 9 H13Z"/>',
  plates: '<path d="M3 8 L12 4 L21 8 L12 12Z M3 12 L12 16 L21 12 M3 16 L12 20 L21 16" stroke-width="2" stroke="currentColor" fill="none"/><path d="M3 8 L12 4 L21 8 L12 12Z"/>',
  gears: `<path d="${gearPath(12, 12, 10, 7, 8)}"/><circle cx="12" cy="12" r="3" fill="#0b1220"/>`,
  cores: '<path d="M12 2 L21 7 V17 L12 22 L3 17 V7Z"/><path d="M12 7 L16.5 9.5 V14.5 L12 17 L7.5 14.5 V9.5Z" fill="#0b1220"/>',
  insight: '<path d="M2 12 Q12 2 22 12 Q12 22 2 12Z"/><circle cx="12" cy="12" r="4" fill="#0b1220"/>',
  ore: '<path d="M4 16 L8 7 L15 5 L20 11 L18 19 L9 20Z"/>',
  strides: '<path d="M4 14 L12 6 L20 14 M4 20 L12 12 L20 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
};
export function resIcon(res, size = 20) {
  return `<svg class="ri" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${RES_COLOR[res]}" style="color:${RES_COLOR[res]}">${resPaths[res] || ''}</svg>`;
}
export function deptBadge(color, letter, size = 28) {
  return `<svg class="ri" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 1 L22 6.5 V17.5 L12 23 L2 17.5 V6.5Z" fill="${color}"/><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="800" fill="#0b1220" font-family="system-ui">${letter}</text></svg>`;
}
export const BOLT = '<path d="M13 2 L4 13 H11 L9 22 L20 9 H13Z"/>';
