// Drawn-in-code art shared by the TV and phones. Everything is SVG strings.
// Resources use colour AND shape so they read from the couch:
//   Ore = red-brown hexagon, Fuel = yellow drop, Power = blue bolt, Part = silver gear, Stride = mint chevrons.
import { CARDS } from '../config.js';

export const RES_COLOR = { ore: '#d8643f', fuel: '#f5c542', power: '#4aa8ff', part: '#d5dde8', stride: '#5cf2a8', supply: '#c9b28a' };
export const RES_NAME = { ore: 'Ore', fuel: 'Fuel', power: 'Power', part: 'Part', stride: 'stride', supply: 'Supply', basic: 'any basic' };
export const KIND_TINT = { extractor: '#16202e', refiner: '#1d1b2c', engine: '#122420', action: '#2a1d14' };

// Icon paths centred on 0,0 with radius ~10.
export function resPath(res, x = 0, y = 0, s = 1, opts = {}) {
  const c = opts.color || RES_COLOR[res];
  const st = opts.stroke === false ? '' : ` stroke="#0b0d14" stroke-width="${1.6 / s}" stroke-linejoin="round"`;
  const g = inner => `<g transform="translate(${x},${y}) scale(${s})">${inner}</g>`;
  switch (res) {
    case 'ore': return g(`<path d="M0,-10 L8.7,-5 L8.7,5 L0,10 L-8.7,5 L-8.7,-5 Z" fill="${c}"${st}/><path d="M-3,-3 L2,-5 L4,0" stroke="#fff6" stroke-width="${1.5 / s}" fill="none"/>`);
    case 'fuel': return g(`<path d="M0,-11 C4,-5 8,-1 8,3.5 A8,8 0 0 1 -8,3.5 C-8,-1 -4,-5 0,-11 Z" fill="${c}"${st}/><ellipse cx="-3" cy="3" rx="1.6" ry="3" fill="#fff8"/>`);
    case 'power': return g(`<path d="M2.5,-11 L-7,1.5 L-0.5,1.5 L-2.5,11 L7,-1.5 L0.5,-1.5 Z" fill="${c}"${st}/>`);
    case 'part': {
      let d = '';
      for (let i = 0; i < 8; i++) {
        const a0 = (i * 45 - 9) * Math.PI / 180, a1 = (i * 45 + 9) * Math.PI / 180;
        d += `${i ? 'L' : 'M'}${(10 * Math.cos(a0)).toFixed(2)},${(10 * Math.sin(a0)).toFixed(2)} L${(10 * Math.cos(a1)).toFixed(2)},${(10 * Math.sin(a1)).toFixed(2)} `;
        const b0 = (i * 45 + 14) * Math.PI / 180, b1 = (i * 45 + 31) * Math.PI / 180;
        d += `L${(7 * Math.cos(b0)).toFixed(2)},${(7 * Math.sin(b0)).toFixed(2)} L${(7 * Math.cos(b1)).toFixed(2)},${(7 * Math.sin(b1)).toFixed(2)} `;
      }
      return g(`<path d="${d}Z" fill="${c}"${st}/><circle r="3.2" fill="#0b0d14"/>`);
    }
    case 'stride': return g(`<path d="M-9,-2 L0,-10 L9,-2 L9,3 L0,-5 L-9,3 Z M-9,7 L0,-1 L9,7 L9,12 L0,4 L-9,12 Z" transform="translate(0,-1)" fill="${c}"${st}/>`);
    case 'supply': return g(`<rect x="-9" y="-8" width="18" height="16" rx="2.5" fill="${c}"${st}/><path d="M-9,-2 H9 M-3,-8 V8 M3,-8 V8" stroke="#6b5838" stroke-width="${1.6 / s}"/>`);
    case 'basic': return g(`<circle r="9" fill="none" stroke="#c9b28a" stroke-width="${2.5 / s}" stroke-dasharray="${4 / s} ${2.5 / s}"/><text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#c9b28a">B</text>`);
  }
  return '';
}
export function resIcon(res, size = 22, cls = '') {
  return `<svg class="ri ${cls}" width="${size}" height="${size}" viewBox="-12 -12 24 24" aria-label="${RES_NAME[res] || res}">${resPath(res)}</svg>`;
}
// A row of icons, e.g. {ore:2, power:1} -> 2 ore icons + 1 power icon
export function resList(obj, size = 20) {
  const out = [];
  for (const [r, n] of Object.entries(obj || {})) {
    if (r === 'stride') { out.push(`<span class="stride-n">${n}${resIcon('stride', size)}</span>`); continue; }
    for (let i = 0; i < n; i++) out.push(resIcon(r, size));
  }
  return out.join('');
}

// Machines, drawn top-down like a factory floor. Centred on 0,0, about 80x80.
// Groups with class spin / rock / pulse animate only while the building runs (CSS).
const BOLTS = [45, 135, 225, 315].map(a => `<circle cx="${(31 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(31 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="2.2" fill="#71819c"/>`).join('');
const base = (rim = '#4a5b78') => `<circle r="37" fill="#18202d" stroke="${rim}" stroke-width="2.5"/><circle r="29" fill="#111722" stroke="#0a0e15" stroke-width="3"/>${BOLTS}`;
const ring = r => `<circle r="${r}" fill="none" stroke="none"/>`; // keeps a spinning group's box centred
function blades(n, len, w, color) {
  let g = '';
  for (let i = 0; i < n; i++) g += `<path d="M0,0 L${-w},${-len * 0.35} L0,${-len} L${w},${-len * 0.35} Z" fill="${color}" stroke="#0a0e15" stroke-width="1.5" transform="rotate(${i * 360 / n})"/>`;
  return g;
}
function gear(r, color, teeth = 8) {
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * 360 / teeth, w = 180 / teeth * 0.55;
    const P = (ang, R) => `${(R * Math.cos(ang * Math.PI / 180)).toFixed(2)},${(R * Math.sin(ang * Math.PI / 180)).toFixed(2)}`;
    d += `${i ? 'L' : 'M'}${P(a - w, r)} L${P(a + w, r)} L${P(a + w * 1.6, r * 0.78)} L${P(a + 360 / teeth - w * 1.6, r * 0.78)} `;
  }
  return `<path d="${d}Z" fill="${color}" stroke="#0a0e15" stroke-width="1.5"/><circle r="${(r * 0.3).toFixed(1)}" fill="#0a0e15"/>`;
}
function machine(cardId) {
  const def = CARDS[cardId];
  const out = Object.keys(def.makes)[0], oc = RES_COLOR[out];
  switch (cardId) {
    case 'orepit': return base() + `<g class="spin">${ring(24)}${blades(3, 24, 7, '#9aa8bf')}</g><circle r="8" fill="${oc}" stroke="#0a0e15" stroke-width="2"/>`;
    case 'deepmine': return base('#8a6b4a') + `<circle r="26" fill="none" stroke="${oc}" stroke-width="2" stroke-dasharray="3 4"/><g class="spin">${ring(24)}${blades(4, 24, 7, '#b3bfd3')}</g><circle r="9" fill="${oc}" stroke="#0a0e15" stroke-width="2"/>`;
    case 'fuelwell': return base() + `<circle r="16" fill="${oc}" opacity=".35"/><circle r="9" fill="${oc}"/><g class="rock"><rect x="-24" y="-4" width="48" height="8" rx="3" fill="#9aa8bf" stroke="#0a0e15" stroke-width="1.5"/><path d="M-24,-9 L-17,-9 L-17,9 L-24,9 Z" fill="#6b7d99"/></g><circle r="4" fill="#0a0e15"/>`;
    case 'refinery': return base('#8a6b4a') + `<rect x="-20" y="-20" width="40" height="40" rx="6" fill="#1f2838" stroke="${oc}" stroke-width="2.5"/><circle cx="-8" cy="-8" r="7" fill="${oc}" class="pulse"/><circle cx="8" cy="8" r="7" fill="${oc}" class="pulse"/><path d="M-8,-8 L8,8" stroke="#9aa8bf" stroke-width="3"/>`;
    case 'dynamo': return base() + `<circle r="9" fill="${oc}" class="pulse"/><g class="spin fast">${ring(27)}${blades(3, 27, 4, '#dfe9f5')}</g><circle r="5" fill="#dfe9f5" stroke="#0a0e15" stroke-width="1.5"/>`;
    case 'geotap': return base('#8a6b4a') + `<circle r="22" fill="none" stroke="${RES_COLOR.fuel}" stroke-width="4" class="pulse"/><circle r="14" fill="none" stroke="${RES_COLOR.power}" stroke-width="4"/><circle r="7" fill="#ffefc2" class="pulse"/>`;
    case 'workshop': return base() + `<rect x="-21" y="-21" width="42" height="42" rx="7" fill="#1f2838" stroke="#ff8f2e" stroke-width="2"/><g class="spin slow">${gear(15, '#c3cddc')}</g>`;
    case 'foundry': return base('#8a6b4a') + `<rect x="-23" y="-23" width="46" height="46" rx="7" fill="#2a1d14" stroke="#ff8f2e" stroke-width="2.5"/><rect x="-17" y="10" width="34" height="7" rx="2" fill="#ff8f2e" class="pulse"/><g transform="translate(-8,-5)"><g class="spin slow">${gear(10, '#c3cddc')}</g></g><g transform="translate(9,-5)"><g class="spin slow rev">${gear(10, '#c3cddc')}</g></g>`;
    case 'assembly': return base('#b98a3a') + `<path d="M0,-25 L22,-12 L22,12 L0,25 L-22,12 L-22,-12 Z" fill="#1f2838" stroke="#ff8f2e" stroke-width="2.5"/><g transform="translate(0,-9)"><g class="spin slow">${gear(9, '#c3cddc')}</g></g><g transform="translate(-9,7)"><g class="spin slow rev">${gear(8, '#c3cddc')}</g></g><g transform="translate(9,7)"><g class="spin slow rev">${gear(8, '#c3cddc')}</g></g>`;
    case 'piston': case 'turbine': case 'strider': {
      const big = cardId === 'strider' ? 1.12 : cardId === 'turbine' ? 1.04 : 0.94;
      const fins = cardId === 'piston' ? 6 : cardId === 'turbine' ? 8 : 10;
      let f = '';
      for (let i = 0; i < fins; i++) f += `<rect x="-2.5" y="-27" width="5" height="9" rx="1.5" fill="#9aa8bf" transform="rotate(${i * 360 / fins})"/>`;
      return base(cardId === 'piston' ? '#4a5b78' : '#8a6b4a') + `<g transform="scale(${big})"><g class="spin">${ring(27)}${f}</g><circle r="18" fill="#0a0e15" stroke="#5b6b86" stroke-width="2"/>
        <g class="pulse"><circle r="13" fill="#ff8f2e"/><circle r="8.5" fill="#ffd27a"/><circle r="4" fill="#fffbe8"/></g></g>`;
    }
  }
  return base() + resPath(out, 0, 0, 1.6);
}
export function tileGlyph(cardId, s = 1) {
  const def = CARDS[cardId];
  if (!def) return '';
  let g = machine(cardId);
  // output chip, top right
  const out = Object.keys(def.makes)[0];
  if (out === 'stride') g += `<g transform="translate(26,-26)"><circle r="13" fill="#0a0e15" stroke="${RES_COLOR.stride}" stroke-width="2.5"/><text y="6" text-anchor="middle" class="tg-n">${def.makes.stride}</text></g>`;
  else {
    const outs = Object.entries(def.makes);
    outs.forEach(([r, n], i) => {
      g += `<g transform="translate(${26 - i * 24},-26)"><circle r="12" fill="#0a0e15" stroke="${RES_COLOR[r]}" stroke-width="2.5"/>${resPath(r, 0, 0, 0.75)}${n > 1 ? `<text x="11" y="13" class="tg-x">${n}</text>` : ''}</g>`;
    });
  }
  // inputs along the bottom
  const ins = [];
  for (const [r, n] of Object.entries(def.needs)) for (let i = 0; i < n; i++) ins.push(r);
  if (ins.length) {
    const w = ins.length * 15 + 8;
    g += `<rect x="${-w / 2}" y="24" width="${w}" height="17" rx="8.5" fill="#0a0e15" stroke="#3a4a66" stroke-width="1.5"/>`;
    ins.forEach((r, i) => { g += resPath(r, (i - (ins.length - 1) / 2) * 15, 32.5, 0.58); });
  }
  // tier pips, top left
  for (let i = 0; i < def.tier; i++) g += `<rect x="${-36 + i * 6}" y="-38" width="4" height="9" rx="1" fill="#ff8f2e"/>`;
  return `<g transform="scale(${s})">${g}</g>`;
}

// Card face HTML (phone). from: 'deck'|'left'|'right'|'reserve'
export function cardFace(cardId) {
  const def = CARDS[cardId];
  const kind = def.kind;
  let body;
  if (kind === 'action') body = `<div class="cf-text">${def.text}</div>`;
  else if (!Object.keys(def.needs).length) body = `<div class="cf-flow"><span class="cf-plus">+</span><span class="cf-makes">${resList(def.makes, 24)}</span></div>`;
  else body = `<div class="cf-flow"><span class="cf-needs">${resList(def.needs, 19)}</span><span class="cf-arrow">▸</span><span class="cf-makes">${resList(def.makes, 24)}</span></div>`;
  return `<div class="cf-top"><span class="cf-name">${def.name}</span><span class="cf-tier">${'I'.repeat(def.tier)}</span></div>
    <svg class="cf-art" viewBox="-40 -40 80 80">${kind === 'action' ? actionGlyph(cardId) : machine(cardId)}</svg>
    ${body}`;
}
export function actionGlyph(cardId) {
  if (cardId === 'overhaul') return `<path d="M-22,-8 H14 L6,-16 M22,8 H-14 L-6,16" stroke="#ff8f2e" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<path d="M4,-30 L-16,4 H-2 L-6,30 L16,-6 H2 Z" fill="#ffe08a" stroke="#0b0d14" stroke-width="2"/><circle r="30" fill="none" stroke="#ffe08a" stroke-width="2" stroke-dasharray="4 6"/>`;
}

// District emblem: a hexagonal factory badge in the player's colour.
export function crest(color, size = 44) {
  return `<svg class="crest" width="${size}" height="${size}" viewBox="-30 -30 60 60">
    <path d="M0,-27 L23.4,-13.5 L23.4,13.5 L0,27 L-23.4,13.5 L-23.4,-13.5 Z" fill="#0a0e15" stroke="${color}" stroke-width="3.5"/>
    <path d="M-12,8 L-12,-4 L-4,-9 L-4,-1 L4,-6 L4,2 L12,-3 L12,8 Z" fill="${color}"/>
    <rect x="-14" y="10" width="28" height="4" rx="1" fill="${color}" opacity=".6"/></svg>`;
}
