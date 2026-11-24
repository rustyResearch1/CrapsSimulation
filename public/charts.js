// SVG chart helpers and number formatting shared by the Strategy Lab and the House page.
export const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
export const num = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '∞');
export const usd = (x, d = 0) => (x < 0 ? '−$' : '$') + num(Math.abs(x), d);
export const susd = (x, d = 0) => (x > 0 ? '+' : '') + usd(x, d);

const NS = 'http://www.w3.org/2000/svg';
export const S = (tag, attrs, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v); el.append(...kids.flat().filter(Boolean)); return el; };
export const txt = (x, y, s, attrs) => { const t = S('text', { x, y, ...attrs }); t.textContent = s; return t; };
export function niceTicks(lo, hi, count) {
  const span = hi - lo || 1, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
export const compact = (v) => (Math.abs(v) >= 10000 ? (v < 0 ? '−$' : '$') + num(Math.abs(v) / 1000, Math.abs(v) % 1000 ? 1 : 0) + 'k' : usd(v));
export function placeTip(tip, box, x, y) {
  tip.style.opacity = 1;
  const w = tip.offsetWidth, left = Math.min(Math.max(4, x + 12), box.clientWidth - w - 4);
  tip.style.left = (x + 12 + w > box.clientWidth ? Math.max(4, x - w - 12) : left) + 'px';
  tip.style.top = Math.max(0, y) + 'px';
}

