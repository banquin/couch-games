// Words for recaps and labels. Names come from theme.js via config.
import { DEPT_INFO, MACHINES, TECHS, TERRAIN, OVERCLOCK, CONFIG } from '../config.js';
import { THEME } from '../theme.js';
export const W = THEME.words;
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const NC = CONFIG.grid.cols, NR = CONFIG.grid.rows, NCELLS = NC * NR;
export const COLS = 'ABCDEFGHIJ'.slice(0, NC);
export const cellName = i => COLS[i % NC] + (Math.floor(i / NC) + 1);
export const dn = d => DEPT_INFO[d].name;
export const dc = d => DEPT_INFO[d].color;
export const mn = t => MACHINES[t].name;
export const tag = d => `<b style="color:${dc(d)}">${esc(dn(d))}</b>`;
export const lvlName = l => ['', 'I', 'II', 'III'][l] || '';

// Recap lines for the TV after a round: blame first, then the save, then notable events. At most `max`.
export function recapLines(ev, max = 6) {
  const out = [];
  if (ev.blame) out.push(`<span class="c-bad">Lost ${ev.blame.lost} ${W.strides}:</span> ${esc(ev.blame.steps.join(' ← '))}${ev.blame.more ? ` <span class="muted">(+${ev.blame.more} more)</span>` : ''}`);
  if (ev.saves && ev.saves.length) {
    const best = ev.saves.slice().sort((a, b) => b.saved.length - a.saved.length)[0];
    out.push(`<span class="c-good">Save of the round:</span> ${tag('shield')}'s ${W.cover} kept ${tag(best.dept)} column ${COLS[best.col]} running (${best.saved.map(mn).join(', ')})${ev.saves.length > 1 ? ` and ${ev.saves.length - 1} more` : ''}.`);
  }
  const hits = ev.strikes.filter(s => s.hit.length);
  if (hits.length) out.push(`${W.Lightning} jammed ${hits.map(s => `${tag(s.dept)} ${COLS[s.at]} (${s.hit.map(h => mn(h.type)).join(', ')})`).join('; ')}.`);
  for (const b of ev.broken.slice(0, 2)) out.push(`${tag(b.from)} delivered ${b.got} of ${b.want} ${W[b.res] || b.res} to ${tag(b.to)}.`);
  if (ev.trip) out.push(`${tag('power')} had ${ev.trip.surplus} ${W.power} left over: ${mn(ev.trip.type)} ${cellName(ev.trip.cell)} trips next round.`);
  if (ev.unlock) out.push(`${tag('research')} sent a ${W.blueprint}: ${tag(ev.unlock)} can upgrade a level higher from next round.`);
  for (const t of ev.techs) out.push(`${tag('research')} brought ${esc(TECHS[t.tech].name)} online: ${esc(TECHS[t.tech].text)}`);
  const lost = ev.waste.filter(w => w.res === 'ore' && w.n >= 3);
  if (lost.length) out.push(`${tag('fab')} lost ${lost[0].n} ${W.ore} (not enough smelting).`);
  return out.slice(0, max);
}

export function terrainLine(id) { const t = TERRAIN[id]; return `${esc(t.name)}${t.grade !== 1 ? ` ×${t.grade}` : ''}`; }
export { OVERCLOCK, TECHS, TERRAIN, MACHINES, DEPT_INFO };
