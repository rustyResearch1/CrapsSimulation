// Strategy Lab: strategy builder, simulation runner, and results.
// Helpers ($, h, store, money, signed) come from common.js; the maths lives in /shared/sim.js.
import { createSim, validate, placeAmount, CRAPS_PRESETS, ROULETTE_PRESETS, LIMITS } from '/shared/sim.js';
import { WHEELS, covers, label, payout } from '/shared/roulette.js';
import { S, txt, niceTicks, compact, placeTip, num, usd, susd, pct } from '/charts.js';

const qs = new URLSearchParams(location.search);
const saved = store.get('lab.cfg') || {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const cfg = {
  game: qs.get('game') === 'roulette' || qs.get('game') === 'craps' ? qs.get('game') : saved.game || 'craps',
  wheel: qs.get('wheel') === 'american' || qs.get('wheel') === 'european' ? qs.get('wheel') : saved.wheel || 'european',
  craps: saved.craps || clone(CRAPS_PRESETS[0].s), crapsPreset: saved.crapsPreset ?? CRAPS_PRESETS[0].id,
  roulette: saved.roulette || clone(ROULETTE_PRESETS[1].s), roulettePreset: saved.roulettePreset ?? ROULETTE_PRESETS[1].id,
  bankroll: saved.bankroll || 1000, rounds: saved.rounds || 100, trials: saved.trials || 10000,
  stopLoss: saved.stopLoss || 0, winGoal: saved.winGoal || 0,
};
let result = null, baseline = null, running = false, runId = 0, addCat = 'red';
const unitName = () => (cfg.game === 'craps' ? 'roll' : 'spin');
const save = () => store.set('lab.cfg', cfg);

// ---------- setup form ----------
function seg(options, value, onPick, cls = '') {
  return h('div', { class: 'seg ' + cls }, options.map(([v, text, sub]) => h('button', { type: 'button', class: v === value ? 'on' : '', on: { click: () => onPick(v) } }, text, sub && h('small', null, sub))));
}
function moneyInput(value, onChange, attrs = {}) {
  const input = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 0, step: 1, value: value || '', ...attrs,
    on: { input: () => { onChange(Math.max(0, Math.floor(+input.value || 0))); save(); } } });
  return h('div', { class: 'money' }, input);
}
const field = (name, control, note) => h('div', { class: 'f' }, h('span', { class: 'lb' }, name), control, note && h('small', null, note));
function touch(game) { cfg[game + 'Preset'] = ''; save(); }   // the strategy no longer matches a preset

const ROULETTE_CATS = [['red', 'Red'], ['black', 'Black'], ['even', 'Even'], ['odd', 'Odd'], ['low', '1 to 18'], ['high', '19 to 36'],
  ['dz', 'Dozen…'], ['col', 'Column…'], ['n', 'Straight number…'], ['sp', 'Split…'], ['st', 'Street…'], ['co', 'Corner…'], ['sl', 'Six line…'], ['zero', 'Zero bets…']];
function keysIn(cat, wheel) {
  const ok = (k) => covers(k, wheel);
  if (cat === 'n') return [...WHEELS[wheel]].sort((a, b) => (a === '00' ? 0.5 : +a) - (b === '00' ? 0.5 : +b)).map((p) => 'n:' + p);
  if (cat === 'dz' || cat === 'col') return [1, 2, 3].map((i) => `${cat}:${i}`);
  if (cat === 'st') return Array.from({ length: 12 }, (_, i) => `st:${i + 1}`);
  if (cat === 'sl') return Array.from({ length: 11 }, (_, i) => `sl:${i + 1}`);
  if (cat === 'co') return Array.from({ length: 32 }, (_, i) => `co:${i + 1}`).filter(ok);
  if (cat === 'sp') { const out = []; for (let a = 1; a <= 36; a++) for (const b of [a + 1, a + 3]) if (ok(`sp:${a}-${b}`)) out.push(`sp:${a}-${b}`); return out; }
  if (cat === 'zero') return ['sp:0-1', 'sp:0-2', 'sp:0-3', 'sp:0-00', 'sp:00-2', 'sp:00-3', 'trio:0-1-2', 'trio:0-2-3', 'trio:0-00-2', 'trio:00-2-3', 'first4', 'top5'].filter(ok);
  return [cat];
}

function renderSetup() {
  const el = $('#setup');
  const strat = h('div', { class: 'panel' }, h('h2', null, 'Strategy'));
  strat.append(field('Game', seg([['craps', 'Craps'], ['roulette', 'Roulette']], cfg.game, (v) => { if (v === cfg.game) return; cfg.game = v; save(); runId++; running = false; result = null; baseline = null; renderSetup(); renderOut(); })));

  if (cfg.game === 'craps') {
    const s = cfg.craps;
    const pick = h('select', { class: 'in', on: { change: () => { const p = CRAPS_PRESETS.find((x) => x.id === pick.value); if (p) { cfg.craps = clone(p.s); cfg.crapsPreset = p.id; save(); renderSetup(); } } } },
      h('option', { value: '' }, 'Custom'), CRAPS_PRESETS.map((p) => h('option', { value: p.id, selected: p.id === cfg.crapsPreset ? '' : null }, p.name)));
    const preset = CRAPS_PRESETS.find((p) => p.id === cfg.crapsPreset);
    const set = (k, v) => { s[k] = v; touch('craps'); renderSetup(); };
    strat.append(field('Start from', pick, preset ? preset.note : 'Your own mix. Change anything below.'),
      field('Line bet', seg([['pass', 'Pass Line'], ['dp', "Don't Pass"], ['none', 'None']], s.line, (v) => set('line', v))));
    if (s.line !== 'none') {
      strat.append(h('div', { class: 'two' },
        field('Line amount', moneyInput(s.lineAmt, (v) => { s.lineAmt = v; touch('craps'); })),
        field('Come bets kept up', seg([[0, '0'], [1, '1'], [2, '2'], [3, '3']], s.come, (v) => set('come', v)))),
        field(s.line === 'dp' ? 'Lay odds once the point is on' : 'Take odds once the point is on',
          seg([[0, 'None'], [1, '1x'], [2, '2x'], [345, '3-4-5x']], s.odds, (v) => set('odds', v)),
          s.odds ? 'True odds: no house edge on this part. It lowers the edge per dollar and raises the swings. Applies to Come bets too.' : null));
    }
    strat.append(field('Place these numbers', h('div', { class: 'nums' }, [4, 5, 6, 8, 9, 10].map((n) =>
      h('button', { type: 'button', class: s.place.includes(n) ? 'on' : '', on: { click: () => set('place', s.place.includes(n) ? s.place.filter((x) => x !== n) : [...s.place, n].sort((a, b) => a - b)) } }, n))),
    s.place.length ? `Each number gets ${s.place.map((n) => `$${placeAmount(n, s.placeUnit)} on ${n}`).join(', ')}. They stay up and are off on the come-out.` : 'Tap numbers to keep them placed.'));
    strat.append(h('div', { class: 'two' },
      s.place.length ? field('Place unit', moneyInput(s.placeUnit, (v) => { s.placeUnit = v; touch('craps'); }, { step: 5 })) : null,
      field('Field, every roll', moneyInput(s.field, (v) => { s.field = v; touch('craps'); })),
      field('Each hardway', moneyInput(s.hard, (v) => { s.hard = v; touch('craps'); }))));
  } else {
    const s = cfg.roulette;
    s.bets = s.bets.filter(([k]) => covers(k, cfg.wheel));
    const pick = h('select', { class: 'in', on: { change: () => { const p = ROULETTE_PRESETS.find((x) => x.id === pick.value); if (p) { cfg.roulette = clone(p.s); cfg.roulettePreset = p.id; save(); renderSetup(); } } } },
      h('option', { value: '' }, 'Custom'), ROULETTE_PRESETS.map((p) => h('option', { value: p.id, selected: p.id === cfg.roulettePreset ? '' : null }, p.name)));
    const preset = ROULETTE_PRESETS.find((p) => p.id === cfg.roulettePreset);
    strat.append(field('Wheel', seg([['european', 'Single zero', '37 pockets'], ['american', 'Double zero', '38 pockets']], cfg.wheel, (v) => { cfg.wheel = v; save(); renderSetup(); })),
      field('Start from', pick, preset ? preset.note : 'Your own layout. Add or remove bets below.'));
    const list = h('div', { class: 'f' }, h('span', { class: 'lb' }, 'Bets placed every spin'));
    s.bets.forEach((b, i) => list.append(h('div', { class: 'betrow' },
      h('b', null, label(b[0]), ' ', h('span', null, `pays ${payout(b[0], cfg.wheel)}:1`)),
      moneyInput(b[1], (v) => { b[1] = v; touch('roulette'); }),
      h('button', { class: 'del', type: 'button', 'aria-label': 'Remove bet', on: { click: () => { s.bets.splice(i, 1); touch('roulette'); renderSetup(); } } }, '×'))));
    if (!s.bets.length) list.append(h('small', null, 'No bets yet. Add one below.'));
    const options = keysIn(addCat, cfg.wheel);
    const catSel = h('select', { class: 'in', 'aria-label': 'Bet type', on: { change: () => { addCat = catSel.value; renderSetup(); } } }, ROULETTE_CATS.map(([v, t]) => h('option', { value: v, selected: v === addCat ? '' : null }, t)));
    const keySel = h('select', { class: 'in', 'aria-label': 'Which one', disabled: options.length < 2 }, options.map((k) => h('option', { value: k }, label(k))));
    list.append(h('div', { class: 'adder' }, catSel, keySel, h('button', { type: 'button', on: { click: () => {
      const key = keySel.value, have = s.bets.find((b) => b[0] === key);
      if (have) have[1] += 5; else s.bets.push([key, key.startsWith('n:') || key.startsWith('sp:') ? 5 : 10]);
      touch('roulette'); renderSetup();
    } } }, 'Add')));
    const layout = s.bets.reduce((t, b) => t + b[1], 0);
    list.append(h('small', null, `Total per spin: $${layout}.`));
    strat.append(list, field('Bet sizing', seg([['flat', 'Flat'], ['martingale', 'Martingale'], ['dalembert', "D'Alembert"], ['fibonacci', 'Fibonacci'], ['paroli', 'Paroli']], s.progression,
      (v) => { s.progression = v; touch('roulette'); renderSetup(); }, 'wrap'),
    { flat: 'Same amounts every spin.', martingale: 'Whole layout doubles after a losing spin, resets after a winning one.', dalembert: 'One unit up after a loss, one down after a win.',
      fibonacci: 'Steps up the Fibonacci sequence on losses, back two on a win.', paroli: 'Doubles after a win, resets after three in a row or any loss.' }[s.progression]));
  }

  const sess = h('div', { class: 'panel' }, h('h2', null, 'Session'));
  const custom = ![10, 50, 100].includes(cfg.rounds);
  sess.append(h('div', { class: 'two' },
    field('Bankroll', moneyInput(cfg.bankroll, (v) => { cfg.bankroll = v; })),
    field(`${unitName()}s per session`, seg([[10, '10'], [50, '50'], [100, '100'], ['x', 'Other']], custom ? 'x' : cfg.rounds, (v) => { cfg.rounds = v === 'x' ? 250 : v; save(); renderSetup(); }))));
  if (custom) {
    const input = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 1, max: 1000, value: cfg.rounds, on: { input: () => { cfg.rounds = Math.min(1000, Math.max(1, Math.floor(+input.value || 1))); save(); } } });
    sess.append(field(`Custom length (1 to 1,000 ${unitName()}s)`, input));
  }
  sess.append(h('div', { class: 'two' },
    field('Stop-loss (optional)', moneyInput(cfg.stopLoss, (v) => { cfg.stopLoss = v; }), 'Quit when down this much.'),
    field('Win goal (optional)', moneyInput(cfg.winGoal, (v) => { cfg.winGoal = v; }), 'Quit when up this much.')),
  field('Sessions to simulate', seg([[2000, '2,000', 'fast'], [10000, '10,000'], [50000, '50,000', 'tight']], cfg.trials, (v) => { cfg.trials = v; save(); renderSetup(); })),
  h('button', { class: 'btn gold', id: 'run', type: 'button', disabled: running, on: { click: run } }, running ? 'Running…' : 'Run simulation'),
  h('div', { id: 'bar', hidden: running ? null : '' }, h('i')), h('div', { id: 'err' }));
  el.replaceChildren(strat, sess);
}

function buildConfig() {
  const cells = 6e6;   // memory guard: sessions x rounds
  const trials = Math.max(500, Math.min(cfg.trials, Math.floor(cells / (cfg.rounds + 1))));
  return { game: cfg.game, rounds: cfg.rounds, trials, bankroll: cfg.bankroll, stopLoss: cfg.stopLoss, winGoal: cfg.winGoal,
    craps: clone(cfg.craps), roulette: { ...clone(cfg.roulette), wheel: cfg.wheel } };
}
function describeStrategy(c) {
  if (c.game === 'roulette') {
    const s = c.roulette;
    return `${s.bets.map(([k, a]) => `$${a} ${label(k)}`).join(' + ')}, ${s.progression}, ${s.wheel === 'american' ? 'double' : 'single'} zero`;
  }
  const s = c.craps, parts = [];
  if (s.line !== 'none') parts.push(`$${s.lineAmt} ${s.line === 'pass' ? 'Pass' : "Don't Pass"}${s.odds ? ` + ${s.odds === 345 ? '3-4-5x' : s.odds + 'x'} odds` : ''}`);
  if (s.line !== 'none' && s.come) parts.push(`${s.come} come bet${s.come > 1 ? 's' : ''}`);
  if (s.place.length) parts.push(`place ${s.place.join(', ')}`);
  if (s.field) parts.push(`$${s.field} field`);
  if (s.hard) parts.push(`$${s.hard} hardways`);
  return parts.join(' + ');
}

async function run() {
  if (running) return;
  const c = buildConfig();
  const err = validate(c);
  if (err) { $('#err').textContent = err; return; }
  const id = ++runId;
  running = true; renderSetup();
  const sim = createSim(c);
  let chunk = 200;
  while (sim.done < sim.total) {
    const t0 = performance.now();
    sim.step(chunk);
    const ms = performance.now() - t0;
    chunk = Math.max(50, Math.min(5000, Math.round(chunk * (30 / Math.max(1, ms)))));   // ~30 ms slices keep the page responsive
    const bar = document.querySelector('#bar i'); if (bar) bar.style.width = (sim.done / sim.total) * 100 + '%';
    await new Promise((r) => setTimeout(r));
    if (id !== runId) return;   // the setup changed underneath this run: drop it
  }
  result = { ...sim.result(), game: c.game, name: describeStrategy(c), unit: c.game === 'craps' ? 'roll' : 'spin', stopLoss: c.stopLoss, winGoal: c.winGoal };
  running = false; renderSetup(); renderOut();
  if (window.innerWidth < 860) $('#out').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- charts ----------
function fanChart(r) {
  const W = Math.max(300, $('#out').clientWidth - 30), H = 230, m = { l: 46, r: 10, t: 8, b: 26 };
  const { p5, p25, p50, p75, p95 } = r.bands, n = r.rounds;
  let lo = Math.min(...p5, r.bankroll), hi = Math.max(...p95, r.bankroll);
  const pad = (hi - lo || 10) * 0.06; lo -= pad; hi += pad;
  const x = (i) => m.l + (i / n) * (W - m.l - m.r), y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = (top, bot) => line(top) + bot.map((v, i) => [x(i), y(v)]).reverse().map(([a, b]) => `L${a.toFixed(1)} ${b.toFixed(1)}`).join('') + 'Z';
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Bankroll range over the session' });
  for (const v of niceTicks(lo, hi, 4)) svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'var(--grid)' }), txt(m.l - 6, y(v) + 3.5, compact(v), { 'text-anchor': 'end' }));
  for (const i of [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n])]) svg.append(txt(x(i), H - 8, i === 0 ? 'start' : `${i}`, { 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle' }));
  svg.append(S('path', { d: area(p95, p5), fill: 'var(--s-blue)', opacity: 0.22 }), S('path', { d: area(p75, p25), fill: 'var(--s-blue)', opacity: 0.34 }),
    S('line', { x1: m.l, x2: W - m.r, y1: y(r.bankroll), y2: y(r.bankroll), stroke: 'var(--dim)', 'stroke-dasharray': '4 4', opacity: 0.8 }),
    S('path', { d: line(p50), fill: 'none', stroke: 'var(--s-blue)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const cross = S('line', { y1: m.t, y2: H - m.b, stroke: 'var(--ink)', opacity: 0 }), dot = S('circle', { r: 4, fill: 'var(--s-blue)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
  svg.append(cross, dot);
  const tip = h('div', { class: 'tip' }), box = h('div', { class: 'chart' }, svg, tip);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect(), px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (W / rect.width);
    const i = Math.min(n, Math.max(0, Math.round(((px - m.l) / (W - m.l - m.r)) * n)));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 0.35);
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p50[i])); dot.setAttribute('opacity', 1);
    tip.replaceChildren(h('b', null, i === 0 ? 'Start' : `After ${r.unit} ${i}`), h('br'), h('span', null, 'Top 5%  '), usd(p95[i]), h('br'), h('span', null, 'Top 25%  '), usd(p75[i]), h('br'),
      h('span', null, 'Median  '), h('b', null, usd(p50[i])), h('br'), h('span', null, 'Bottom 25%  '), usd(p25[i]), h('br'), h('span', null, 'Bottom 5%  '), usd(p5[i]));
    placeTip(tip, box, (x(i) / W) * rect.width, 4);
  };
  const out = () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.style.opacity = 0; };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', out);
  return box;
}

function histogram(r) {
  const W = Math.max(300, $('#out').clientWidth - 30), H = 200, m = { l: 10, r: 10, t: 16, b: 26 };
  const f = r.finals, T = f.length;
  let lo = f[Math.floor(T * 0.005)], hi = f[Math.min(T - 1, Math.ceil(T * 0.995))];
  if (hi - lo < 1) { lo -= 5; hi += 5; }
  const bins = Math.min(31, Math.max(9, Math.floor((W - m.l - m.r) / 14))), step = (hi - lo) / bins, counts = new Array(bins).fill(0);
  for (let i = 0; i < T; i++) counts[Math.min(bins - 1, Math.max(0, Math.floor((f[i] - lo) / step)))]++;
  const peak = Math.max(...counts), slot = (W - m.l - m.r) / bins, bw = Math.min(24, slot - 2);
  const x = (v) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r), base = H - m.b;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Distribution of session results' });
  svg.append(S('line', { x1: m.l, x2: W - m.r, y1: base, y2: base, stroke: 'var(--grid)' }));
  const tip = h('div', { class: 'tip' }), box = h('div', { class: 'chart' }, svg, tip);
  counts.forEach((c, i) => {
    const a = lo + i * step, b = a + step, hgt = c ? Math.max(2, (c / peak) * (base - m.t)) : 0;
    const fill = b <= 0 ? 'var(--s-red)' : a >= 0 ? 'var(--s-blue)' : 'var(--s-mid)';
    const cx = m.l + i * slot + slot / 2;
    const bar = S('path', { d: `M${cx - bw / 2} ${base}v${-(hgt - 3)}q0 -3 3 -3h${bw - 6}q3 0 3 3v${hgt - 3}z`, fill, opacity: hgt ? 1 : 0 });
    const hit = S('rect', { x: m.l + i * slot, y: m.t, width: slot, height: base - m.t, fill: 'transparent' });
    const show = () => {
      bar.setAttribute('opacity', 0.75);
      tip.replaceChildren(h('b', null, `${susd(a)} to ${susd(b)}`), h('br'), `${pct(c / T)} of sessions`, i === 0 || i === bins - 1 ? h('span', null, '  (incl. tail)') : null);
      placeTip(tip, box, (cx / W) * svg.getBoundingClientRect().width, 0);
    };
    hit.addEventListener('pointerenter', show); hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { bar.setAttribute('opacity', hgt ? 1 : 0); tip.style.opacity = 0; });
    svg.append(bar, hit);
  });
  const mark = (v, text, color, above) => {
    if (v < lo || v > hi) return;
    svg.append(S('line', { x1: x(v), x2: x(v), y1: above ? m.t - 4 : m.t + 8, y2: base, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': above ? null : '3 3', 'pointer-events': 'none' }),
      txt(Math.min(W - 30, Math.max(30, x(v))), above ? m.t - 7 : m.t + 5, text, { 'text-anchor': 'middle', 'pointer-events': 'none', style: 'fill:var(--ink)' }));
  };
  if (lo < 0 && hi > 0) {
    svg.append(S('line', { x1: x(0), x2: x(0), y1: m.t + 4, y2: base + 4, stroke: 'var(--dim)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', 'pointer-events': 'none' }));
    if (x(0) > m.l + 80 && x(0) < W - m.r - 80) svg.append(txt(x(0), H - 8, 'break even', { 'text-anchor': 'middle' }));
  }
  mark(r.mean, `mean ${susd(r.mean)}`, 'var(--ink)', true);
  svg.append(txt(m.l, H - 8, susd(lo)), txt(W - m.r, H - 8, susd(hi), { 'text-anchor': 'end' }));
  return box;
}

// ---------- results ----------
function tile(k, v, s, cls) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, s)); }

function renderOut() {
  const el = $('#out'), r = result;
  if (!r) {
    el.replaceChildren(h('div', { class: 'panel' }, h('h2', null, 'Results'),
      h('p', { class: 'method', style: 'font-size:13.5px;color:#d8e4dc' }, 'Pick a strategy and press Run simulation. You will get the expected result with its confidence interval, standard deviation and variance, the chance of finishing ahead, risk of ruin, drawdown, the range of bankroll paths, and the full distribution of session results.')));
    return;
  }
  const b = baseline;
  const ratio = r.mean ? r.sd / Math.abs(r.mean) : Infinity;
  const tiles = h('div', { class: 'tiles' },
    tile('Expected result', susd(r.mean, Math.abs(r.mean) < 100 ? 2 : 0), `95% CI ${susd(r.ci95[0], 1)} to ${susd(r.ci95[1], 1)} · ${pct(r.mean / r.bankroll)} of bankroll`, r.mean > 0 ? 'pos' : 'neg'),
    tile('Standard deviation', usd(r.sd), `per session · ${usd(r.sdRound, 2)} per ${r.unit} · variance ${num(r.variance)}`),
    tile('Finish ahead', pct(r.winRate), `median session ${susd(r.median)}`),
    tile('Max drawdown', usd(r.ddMean), `average peak-to-trough fall · 1 in 20 sessions worse than ${usd(r.ddP95)}`),
    tile('Risk of ruin', pct(r.bustRate), r.bustRate ? `sessions that could not cover the next bet · avg ${num(r.avgRounds, 1)} ${r.unit}s played` : `no session ran out of chips in ${r.rounds} ${r.unit}s`),
    tile('House edge paid', pct(r.edge, 2), `of ${usd(r.avgWagered)} in bets decided per session`));

  const fan = h('div', { class: 'panel' }, h('p', { class: 'ctitle' }, 'Bankroll through the session'),
    h('p', { class: 'csub' }, `Where ${num(r.trials)} sessions stood after each ${r.unit}. Dashed line is the starting bankroll.`),
    h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--s-blue);height:3px' }), 'Median'), h('span', null, h('i', { style: 'background:var(--s-blue);opacity:.56' }), 'Middle 50% of sessions'),
      h('span', null, h('i', { style: 'background:var(--s-blue);opacity:.26' }), 'Middle 90%')),
    fanChart(r));
  const dist = h('div', { class: 'panel' }, h('p', { class: 'ctitle' }, 'Session results'),
    h('p', { class: 'csub' }, `How often a session ends at each profit or loss after ${r.rounds} ${r.unit}s.`),
    h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--s-red)' }), 'Loss'), h('span', null, h('i', { style: 'background:var(--s-blue)' }), 'Profit')),
    histogram(r));

  const rows = [
    ['sec', 'Expected value'],
    ['Mean result', (x) => susd(x.mean, 2), 'average profit or loss per session'],
    ['95% confidence interval', (x) => `${susd(x.ci95[0], 1)} to ${susd(x.ci95[1], 1)}`, 'where the true mean lies, given this many sessions'],
    ['Standard error', (x) => usd(x.stderr, 2)],
    [`Mean per ${r.unit}`, (x) => susd(x.evRound, 3)],
    ['House edge realised', (x) => pct(x.edge, 2), 'loss per dollar of bets decided'],
    ['Bets decided per session', (x) => usd(x.avgWagered)],
    ['sec', 'Variance'],
    ['Standard deviation, session', (x) => usd(x.sd, 2)],
    ['Variance, session', (x) => num(x.variance)],
    [`Standard deviation per ${r.unit}`, (x) => usd(x.sdRound, 2)],
    ['Luck to edge ratio', (x) => (x.mean ? num(x.sd / Math.abs(x.mean), 1) + ' : 1' : '∞'), 'session SD divided by expected result'],
    [`N0, ${r.unit}s until edge = luck`, (x) => num(x.n0), '(SD ÷ EV)² per round: past this, the edge outweighs one SD of luck'],
    ['Skewness', (x) => num(x.skew, 2), 'negative: many small wins, rare large losses'],
    ['Excess kurtosis', (x) => num(x.kurtosis, 2), 'above 0: fatter tails than a bell curve'],
    ['sec', 'Outcomes'],
    ['Finish ahead', (x) => pct(x.winRate)],
    ['Risk of ruin', (x) => pct(x.bustRate, 2)],
    ...(r.winGoal || (b && b.winGoal) ? [['Hit win goal', (x) => pct(x.goalRate)]] : []),
    ...(r.stopLoss || (b && b.stopLoss) ? [['Hit stop-loss', (x) => pct(x.stopRate)]] : []),
    [`Average ${r.unit}s played`, (x) => num(x.avgRounds, 1)],
    ['sec', 'Result percentiles'],
    ['Best session', (x) => susd(x.best)], ['99th', (x) => susd(x.pct.p99)], ['95th', (x) => susd(x.pct.p95)], ['75th', (x) => susd(x.pct.p75)], ['Median', (x) => susd(x.pct.p50)],
    ['25th', (x) => susd(x.pct.p25)], ['5th', (x) => susd(x.pct.p5)], ['1st', (x) => susd(x.pct.p1)], ['Worst session', (x) => susd(x.worst)],
    ['sec', 'Drawdown (peak to trough)'],
    ['Average', (x) => usd(x.ddMean)], ['Median', (x) => usd(x.ddMedian)], ['95th percentile', (x) => usd(x.ddP95)], ['Worst seen', (x) => usd(x.ddWorst)],
  ];
  const table = h('table', { class: 'st' }, h('tr', null, h('th', null, 'Statistic'), h('th', null, b ? 'This run' : 'Value'), b && h('th', null, 'Baseline')),
    rows.map((row) => (row[0] === 'sec' ? h('tr', { class: 'sec' }, h('td', { colspan: b ? 3 : 2 }, row[1]))
      : h('tr', null, h('td', null, row[0], row[2] && h('small', null, row[2])), h('td', null, row[1](r)), b && h('td', { class: 'base' }, row[1](b))))));
  const detail = h('div', { class: 'panel' }, h('h2', null, 'Full statistics'),
    h('p', { class: 'csub' }, b ? `This run: ${r.name}. Baseline: ${b.name}.` : r.name),
    table,
    h('div', { class: 'rowbtn' },
      h('button', { class: 'btn ghost', type: 'button', on: { click: () => { baseline = r; renderOut(); } } }, b ? 'Make this the baseline' : 'Pin as baseline to compare'),
      b && h('button', { class: 'btn ghost', type: 'button', on: { click: () => { baseline = null; renderOut(); } } }, 'Clear baseline')));

  const read = h('div', { class: 'panel' }, h('h2', null, 'Reading it'), h('ul', { class: 'read' },
    h('li', null, `Over ${r.rounds} ${r.unit}s the edge costs about ${usd(Math.abs(r.mean), 2)} on average, while one standard deviation of luck is ${usd(r.sd)}. Luck is ${Number.isFinite(ratio) ? num(ratio, 1) : 'far'} times larger than the edge at this length, which is why short sessions feel beatable.`),
    h('li', null, Number.isFinite(r.n0) ? `That flips with volume: after roughly ${num(r.n0)} ${r.unit}s (N0) the expected loss is as big as the luck, and it keeps growing faster than luck does.` : 'This strategy showed no measurable edge either way in this run.'),
    h('li', null, `Nine sessions in ten end between ${susd(r.pct.p5)} and ${susd(r.pct.p95)}. Size the bankroll for the drawdown, not the average: expect to be down ${usd(r.ddMean)} from your high point at some stage, and ${usd(r.ddP95)} or more in 1 session out of 20.`),
    r.skew < -0.5 ? h('li', null, `Results are skewed to the downside (${num(r.skew, 2)}): the strategy wins small and often, and pays for it with occasional large losses. A high win rate here is not a sign of an edge.`) : null,
    r.skew > 0.5 ? h('li', null, `Results are skewed to the upside (${num(r.skew, 2)}): most sessions lose a little, a few win big.`) : null,
    h('li', null, 'To test an idea, pin this run as the baseline, change one thing, and run again. Compare mean and standard deviation together: a change that lowers the edge paid per dollar, or the same edge at lower variance, is a real improvement. A higher win rate alone is not.')));

  const method = h('div', { class: 'panel' }, h('h2', null, 'Method'), h('p', { class: 'method' },
    `Monte Carlo: ${num(r.trials)} independent sessions of ${r.rounds} ${r.unit}s, each played bet by bet through the live tables' rules engine with the same limits (payouts round down to whole dollars). `
    + 'Bets still on the table when a session ends are counted at face value. Standard deviation and variance are across sessions; the per-round figures pool every round played. '
    + 'The confidence interval covers sampling error in the mean only, so run more sessions to tighten it. The simulator uses the browser\'s pseudo-random generator; the live tables use a cryptographic one. Neither can be predicted from past results.'));

  el.replaceChildren(tiles, fan, dist, read, detail, method);
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (result) renderOut(); }, 150); });
renderSetup(); renderOut();
window.labRun = run;
