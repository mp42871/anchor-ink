/**
 * Guided tour: dims the screen, spotlights one control at a time and explains
 * it in a large callout. The overlay never blocks the app, so a teacher can
 * try each thing (write, scroll, open a tool) while the tour is showing.
 */
export interface TourStep {
  /** CSS selector of the thing to spotlight; omit for a centred message */
  target?: string;
  title: string;
  text: string;
  /** run before showing the step (e.g. make sure the toolbar is open) */
  before?: () => void;
  /** extra padding around the spotlight */
  pad?: number;
}

let active: { close: () => void } | null = null;

export function isTourRunning() {
  return !!active;
}

export function runTour(steps: TourStep[], opts: { onFinish?: (completed: boolean) => void; finishLabel?: string } = {}) {
  active?.close();
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-dim"></div>
    <div class="tour-spot"></div>
    <div class="tour-bubble" role="dialog" aria-live="polite">
      <div class="tour-count"></div>
      <h3 class="tour-title"></h3>
      <p class="tour-text"></p>
      <div class="tour-btns">
        <button class="btn tour-skip">Skip tour</button>
        <span class="spacer"></span>
        <button class="btn tour-back">Back</button>
        <button class="btn primary tour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const dim = root.querySelector<HTMLElement>('.tour-dim')!;
  const spot = root.querySelector<HTMLElement>('.tour-spot')!;
  const bubble = root.querySelector<HTMLElement>('.tour-bubble')!;
  const back = root.querySelector<HTMLButtonElement>('.tour-back')!;
  const next = root.querySelector<HTMLButtonElement>('.tour-next')!;
  let i = 0;
  let raf = 0;
  let finished = false;

  const visible = (el: Element | null): el is HTMLElement => {
    if (!el) return false;
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !(el as HTMLElement).closest('[hidden]');
  };

  const place = () => {
    const step = steps[i];
    const el = step.target ? document.querySelector(step.target) : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    if (!visible(el)) {
      spot.style.display = 'none';
      dim.style.display = 'block';
      bubble.style.left = Math.max(8, (vw - bw) / 2) + 'px';
      bubble.style.top = Math.max(8, (vh - bh) / 2) + 'px';
      return;
    }
    dim.style.display = 'none';
    spot.style.display = 'block';
    const pad = step.pad ?? 8;
    const r = el.getBoundingClientRect();
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
    Object.assign(spot.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    // put the callout on whichever side has the most room
    const gap = 18;
    const room = { right: vw - (x + w), left: x, below: vh - (y + h), above: y };
    let bx: number, by: number;
    if (room.right >= bw + gap) { bx = x + w + gap; by = y + h / 2 - bh / 2; }
    else if (room.left >= bw + gap) { bx = x - gap - bw; by = y + h / 2 - bh / 2; }
    else if (room.below >= bh + gap) { bx = x + w / 2 - bw / 2; by = y + h + gap; }
    else if (room.above >= bh + gap) { bx = x + w / 2 - bw / 2; by = y - gap - bh; }
    else { bx = (vw - bw) / 2; by = vh - bh - 16; }
    bubble.style.left = Math.max(8, Math.min(vw - bw - 8, bx)) + 'px';
    bubble.style.top = Math.max(8, Math.min(vh - bh - 8, by)) + 'px';
  };

  const loop = () => { place(); raf = requestAnimationFrame(loop); };

  const show = () => {
    const step = steps[i];
    step.before?.();
    root.querySelector('.tour-count')!.textContent = `${i + 1} of ${steps.length}`;
    root.querySelector('.tour-title')!.textContent = step.title;
    root.querySelector('.tour-text')!.innerHTML = step.text;
    back.hidden = i === 0;
    next.textContent = i === steps.length - 1 ? opts.finishLabel || 'Finish' : 'Next';
    requestAnimationFrame(place);
  };

  const close = () => {
    if (!root.isConnected) return;
    cancelAnimationFrame(raf);
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    active = null;
    opts.onFinish?.(finished);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); back.click(); }
  };
  next.addEventListener('click', () => {
    if (i < steps.length - 1) { i++; show(); } else { finished = true; close(); }
  });
  back.addEventListener('click', () => { if (i > 0) { i--; show(); } });
  root.querySelector('.tour-skip')!.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  active = { close };
  show();
  raf = requestAnimationFrame(loop);
  return close;
}
