import { settings, saveSettings } from './settings';
import { classify, size, fingerDraws } from './input';
import { h, modal } from './ui';

/**
 * Pen setup: measures how big the Clevertouch pen tip and a fingertip look to
 * the touch panel. If they differ, the pen writes and fingers scroll; palms
 * resting on the board are ignored. Also a scratch pad to try writing.
 */
export function showPenSetup(onDone?: () => void) {
  const body = h(`<div class="pen-setup">
    <p class="lead step-text"></p>
    <div class="pad-wrap"><canvas class="pad"></canvas><div class="pad-hint"></div></div>
    <p class="readout muted">Waiting for a touch…</p>
    <div class="result" hidden></div>
    <div class="row end">
      <button class="btn" data-a="restart">Start over</button>
      <button class="btn primary" data-a="next">Next</button>
    </div>
  </div>`);
  const m = modal('Pen setup', body, { wide: true, onClose: () => { ro.disconnect(); onDone?.(); } });
  const pad = body.querySelector<HTMLCanvasElement>('.pad')!;
  const ctx = pad.getContext('2d')!; // not desynchronized: it turns transparent canvases black on some panels
  const stepText = body.querySelector<HTMLElement>('.step-text')!;
  const hint = body.querySelector<HTMLElement>('.pad-hint')!;
  const readout = body.querySelector<HTMLElement>('.readout')!;
  const result = body.querySelector<HTMLElement>('.result')!;
  const next = body.querySelector<HTMLButtonElement>('[data-a=next]')!;

  let step: 'pen' | 'finger' | 'test' = 'pen';
  const samples = { pen: [] as number[], finger: [] as number[], penTypes: new Set<string>() };
  const last = new Map<number, { x: number; y: number; color: string; w: number }>();

  const fit = () => {
    const r = pad.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    pad.width = Math.round(r.width * dpr);
    pad.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(pad);

  const setStep = (s: typeof step) => {
    step = s;
    fit();
    last.clear();
    if (s === 'pen') {
      stepText.innerHTML = '<b>Step 1 of 2.</b> Pick up the Clevertouch pen and write a few words on the pad below.';
      hint.textContent = 'Write here with the pen';
      next.textContent = 'Next';
      next.disabled = true;
      result.hidden = true;
    } else if (s === 'finger') {
      stepText.innerHTML = '<b>Step 2 of 2.</b> Now draw a few lines with <b>one fingertip</b> (not the pen).';
      hint.textContent = 'Draw here with a finger';
      next.textContent = 'Finish';
      next.disabled = true;
    } else {
      stepText.innerHTML = '<b>Try it.</b> Write with the pen, touch with a finger, rest your hand. Black ink = writes, grey dots = scrolls, nothing = ignored.';
      hint.textContent = '';
      next.textContent = 'Done';
      next.disabled = false;
    }
    hint.hidden = !hint.textContent;
  };

  const mark = (e: PointerEvent, down: boolean) => {
    const r = pad.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const s = size(e);
    readout.textContent = `Last contact: ${e.pointerType}${s ? `, size ${s.toFixed(1)} px` : ', size not reported'}${e.pressure && e.pressure !== 0.5 ? `, pressure ${e.pressure.toFixed(2)}` : ''}`;
    let color = '#111', w = 3;
    if (step === 'pen') { samples.pen.push(s); samples.penTypes.add(e.pointerType); }
    else if (step === 'finger') { samples.finger.push(s); color = '#1e5bd8'; w = 5; }
    else {
      const k = classify(e);
      if (k === 'palm') return;
      if (k === 'finger' && !fingerDraws()) {
        ctx.fillStyle = 'rgba(100,110,130,.5)';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        return;
      }
    }
    const prev = last.get(e.pointerId);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (prev && !down) ctx.moveTo(prev.x, prev.y); else ctx.moveTo(x - 0.01, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last.set(e.pointerId, { x, y, color, w });
  };

  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); mark(e, true); });
  pad.addEventListener('pointermove', (e) => {
    if (!last.has(e.pointerId)) return;
    for (const ce of (e.getCoalescedEvents?.() || [e])) mark(ce, false);
  });
  const end = (e: PointerEvent) => {
    last.delete(e.pointerId);
    if (step === 'pen' && samples.pen.length >= 15) next.disabled = false;
    if (step === 'finger' && samples.finger.length >= 15) next.disabled = false;
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  body.querySelector('[data-a=restart]')!.addEventListener('click', () => {
    samples.pen = []; samples.finger = []; samples.penTypes.clear();
    setStep('pen');
  });
  next.addEventListener('click', () => {
    if (step === 'pen') setStep('finger');
    else if (step === 'finger') { analyse(); setStep('test'); }
    else m.close();
  });

  function analyse() {
    const pct = (a: number[], q: number) => {
      const s = a.slice().sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] || 0;
    };
    let msg: string, ok = false;
    if (samples.penTypes.has('pen')) {
      settings.penMaxSize = 0; settings.fingerSize = 0;
      msg = 'Your board reports the pen as a real stylus. <b>The pen will write and fingers will scroll</b>, with no extra settings needed.';
      ok = true;
    } else {
      const penHi = pct(samples.pen, 0.9), fingerLo = pct(samples.finger, 0.1), fingerMid = pct(samples.finger, 0.5);
      if (fingerLo <= 1.01) {
        settings.penMaxSize = 0; settings.fingerSize = 0;
        msg = "This board doesn't report how big each touch is, so it can't tell the pen from a finger. " +
          '<b>The pen and fingers will both write</b>, and two fingers scroll and zoom.';
      } else if (penHi < fingerLo * 0.85) {
        settings.penMaxSize = +((penHi + fingerLo) / 2).toFixed(2);
        settings.fingerSize = fingerMid;
        msg = `The pen tip (about ${penHi.toFixed(1)} px) is clearly smaller than a fingertip (about ${fingerMid.toFixed(1)} px). ` +
          '<b>The pen will write, fingers will scroll, and a resting hand is ignored.</b>';
        ok = true;
      } else {
        settings.penMaxSize = 0; settings.fingerSize = 0;
        msg = `The pen (about ${penHi.toFixed(1)} px) and a fingertip (about ${fingerMid.toFixed(1)} px) look the same size to this board, so ` +
          '<b>both will write</b>. Two fingers scroll and zoom. Try <i>Start over</i> pressing more lightly with your finger.';
      }
    }
    if (ok && settings.drawWith === 'all') settings.drawWith = 'auto';
    saveSettings();
    result.hidden = false;
    result.className = 'result ' + (ok ? 'good' : 'warn');
    result.innerHTML = msg;
  }

  setStep('pen');
}
