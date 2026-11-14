// Words for the TV recap and phone hints.
import { CARDS } from '../config.js';
import { RES_NAME, resIcon } from './art.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cardName = c => (CARDS[c] || { name: c }).name;
export function who(v, seat) { const p = v.players[seat]; return `<b style="color:${p.color}">${esc(p.name)}</b>`; }
const list = (obj) => Object.keys(obj).map(r => RES_NAME[r]).join(' + ');

// One line per notable event, most important first. Returns HTML strings.
export function recapLines(v) {
  const L = v.last;
  if (!L) return [];
  const out = [];
  const ev = L.events;
  out.push(`The city walked <b class="c-stride">${L.walked}</b> strides${L.bonusUsed ? ` (engines ${L.engineStrides} + Main Drive ${L.bonusUsed})` : ''}.`);
  for (const e of ev.filter(e => e.t === 'stage')) out.push(`<b class="c-gold">Main Drive stage ${e.stage} complete!</b> +${e.add} strides every round from now on.`);
  const starvedEng = ev.filter(e => e.t === 'starved' && CARDS[e.card].kind === 'engine');
  const starvedOther = ev.filter(e => e.t === 'starved' && CARDS[e.card].kind !== 'engine');
  for (const e of starvedEng.slice(0, 3)) out.push(`${who(v, e.seat)}'s ${cardName(e.card)} starved: no ${list(e.missing)}.`);
  if (starvedEng.length > 3) out.push(`${starvedEng.length - 3} more engines starved.`);
  if (starvedOther.length && out.length < 5) out.push(`${starvedOther.length} other building${starvedOther.length > 1 ? 's' : ''} went dark for lack of inputs.`);
  for (const e of ev.filter(e => e.t === 'fed')) out.push(`${who(v, e.seat)}'s crates kept an engine running.`);
  const gifts = ev.filter(e => e.t === 'generous');
  if (gifts.length) out.push(`Gifts built: ${gifts.map(e => `${who(v, e.seat)}→${who(v, e.to)} ${cardName(e.card)}`).join(', ')}. Each giver gets a ${v.generosityKind === 'part' ? 'Part' : 'Supply'} crate.`);
  for (const e of ev.filter(e => e.t === 'commit')) out.push(`${who(v, e.seat)} sent a ${e.crate === 'part' ? 'Part' : 'Supply'} crate to the Main Drive${e.to !== e.seat ? ` for ${who(v, e.to)}'s district` : ''}.`);
  if (L.prod.off.length) out.push(`${v.stormType === 'lightning' ? 'Lightning' : 'Sand'} shut down ${L.prod.off.length} building${L.prod.off.length > 1 ? 's' : ''}.`);
  const gap = L.city - L.storm;
  if (L.outcome === 'won') out.push(`<b class="c-good">The city reached the Haven!</b>`);
  else if (L.outcome === 'caught') out.push(`<b class="c-bad">The storm moved ${L.speed} and swallowed the city.</b>`);
  else out.push(`The storm moved ${L.speed}. It is <b class="${gap <= 5 ? 'c-bad' : ''}">${gap}</b> behind.`);
  // keep the first line and the storm line; trim the middle so the rail never overflows
  if (out.length > 6) out.splice(5, out.length - 6);
  return out;
}

// A gentle "specialty" hint for first games, based on what the player has built.
export function leanHint(v, seat) {
  const D = v.districts[seat];
  const count = k => D.filter(b => b && CARDS[b.card].kind === k).length;
  const makes = r => D.filter(b => b && CARDS[b.card].makes[r]).length;
  const st = v.core.current;
  if (st && v.core.progress[seat] < st.need) {
    if (st.res === 'part') return v.me && v.me.crates.part ? `You have a ${resIcon('part', 16)} Part crate: send it to the Main Drive below.` : `The Main Drive needs a ${resIcon('part', 16)} Part from you. Every card you pass that gets built earns a Part crate. A Workshop in your top row also delivers one each round.`;
    return `The Main Drive needs ${st.need} basic resource from you. Any producer in your top row (next to the core) delivers it.`;
  }
  if (makes('part') >= 2) return "You're the Parts supplier. Turbines next to your Workshops will love you.";
  if (count('engine') >= 3) return "You're an engine district. Ask your neighbours to put Fuel and Power on your border.";
  if (count('extractor') >= 4) return "You're a supply district. Producers on your left and right edges feed your neighbours too.";
  return 'Buildings feed every touching tile, even across the border into your neighbours.';
}
