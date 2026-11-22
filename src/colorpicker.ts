/** Big, finger-friendly HSV colour picker (no tiny native dialogs on a 75" board). */

const RECENT_KEY = 'anchor-ink-custom-colors';

export function recentColors(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); } catch { return []; }
}
export function rememberColor(c: string) {
  const list = [c, ...recentColors().filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/.{2}/g) || ['00', '00', '00'];
  const [r, g, b] = m.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

export function createColorPicker(initial: string, onChange: (hex: string) => void, onCommit: (hex: string) => void) {
  let [hh, ss, vv] = hexToHsv(/^#[0-9a-f]{6}$/i.test(initial) ? initial : '#1e5bd8');
  const el = document.createElement('div');
  el.className = 'cpick';
  el.innerHTML = `
    <div class="cp-sv"><canvas></canvas><i class="cp-knob"></i></div>
    <div class="cp-hue"><i class="cp-knob"></i></div>
    <div class="cp-foot"><span class="cp-chip"></span><input class="cp-hex" maxlength="7" spellcheck="false"><button class="btn primary cp-ok">Use colour</button></div>`;
  const sv = el.querySelector<HTMLElement>('.cp-sv')!;
  const canvas = sv.querySelector('canvas')!;
  const svKnob = sv.querySelector<HTMLElement>('.cp-knob')!;
  const hue = el.querySelector<HTMLElement>('.cp-hue')!;
  const hueKnob = hue.querySelector<HTMLElement>('.cp-knob')!;
  const chip = el.querySelector<HTMLElement>('.cp-chip')!;
  const hexIn = el.querySelector<HTMLInputElement>('.cp-hex')!;

  const paintSv = () => {
    const w = (canvas.width = 120), hgt = (canvas.height = 80);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = hsvToHex(hh, 1, 1);
    ctx.fillRect(0, 0, w, hgt);
    const g1 = ctx.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, '#fff'); g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, w, hgt);
    const g2 = ctx.createLinearGradient(0, 0, 0, hgt);
    g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, hgt);
  };
  const update = (emit = true) => {
    const hex = hsvToHex(hh, ss, vv);
    svKnob.style.left = ss * 100 + '%';
    svKnob.style.top = (1 - vv) * 100 + '%';
    svKnob.style.background = hex;
    hueKnob.style.left = (hh / 360) * 100 + '%';
    hueKnob.style.background = hsvToHex(hh, 1, 1);
    chip.style.background = hex;
    if (document.activeElement !== hexIn) hexIn.value = hex;
    if (emit) onChange(hex);
  };
  const drag = (target: HTMLElement, fn: (fx: number, fy: number) => void) => {
    const at = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
    };
    target.addEventListener('pointerdown', (e) => { e.preventDefault(); target.setPointerCapture(e.pointerId); at(e); });
    target.addEventListener('pointermove', (e) => { if (target.hasPointerCapture(e.pointerId)) at(e); });
  };
  drag(sv, (fx, fy) => { ss = fx; vv = 1 - fy; update(); });
  drag(hue, (fx) => { hh = Math.min(359.9, fx * 360); paintSv(); update(); });
  hexIn.addEventListener('input', () => {
    const v = hexIn.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) { [hh, ss, vv] = hexToHsv(v.startsWith('#') ? v : '#' + v); paintSv(); update(); }
  });
  el.querySelector('.cp-ok')!.addEventListener('click', () => onCommit(hsvToHex(hh, ss, vv)));
  paintSv();
  update(false);
  return el;
}
