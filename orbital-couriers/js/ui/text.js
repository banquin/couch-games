// Plain-English descriptions of game events, shared by the TV and phones.
import { CARDS } from '../config.js';
import { CARGO_ICON } from './board.js';

export const DIR_WORD = { N: 'up', E: 'right', S: 'down', W: 'left' };
export const DIR_ARROW = { N: '↑', E: '→', S: '↓', W: '←' };

export function planetName(view, key) { return (view.cfg.planets[key] || {}).name || key; }
export function nameOf(view, id) { const p = view.players.find(x => x.id === id); return p ? p.name : id; }
export function cardText(type, dir) {
  const c = CARDS[type];
  return c.label + (dir ? ' ' + DIR_ARROW[dir] : '');
}
export function cargoIcon(c) { return CARGO_ICON[c] || '■'; }

// Returns notable lines for one beat (one ship's move).
export function beatLines(view, beat) {
  const out = [];
  const N = id => `<b style="color:${colorOf(view, id)}">${esc(nameOf(view, id))}</b>`;
  for (const e of beat.events) {
    switch (e.t) {
      case 'bump': out.push(`${N(e.id)} rammed ${N(e.victim)}${e.moved ? '' : ' (it held firm)'}!`); break;
      case 'pull': out.push(`${N(e.id)} got pulled by ${view.cfg.wellNames?.[e.well] || 'a gravity well'}.`); break;
      case 'shield': out.push(`${N(e.id)} shrugged off gravity with a shield.`); break;
      case 'slingshot': out.push(`${N(e.id)} slingshot out of a well (+1 space).`); break;
      case 'load': out.push(`${N(e.id)} loaded ${cargoIcon(e.cargo)} ${e.cargo} at ${planetName(view, e.from)}.`); break;
      case 'deliver': out.push(`${N(e.id)} delivered ${cargoIcon(e.cargo)} ${e.cargo} to ${planetName(view, e.to)} first! +${e.points}★`); break;
      case 'salvaged': out.push(`${N(e.id)}'s ${e.cargo} is now salvage.`); break;
      case 'sell': out.push(`${N(e.id)} sold salvage for ${e.credits}⬢.`); break;
    }
  }
  return out;
}
export function colorOf(view, id) { const p = view.players.find(x => x.id === id); return p ? p.color : '#fff'; }
export function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
