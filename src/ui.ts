import { icon } from './icons';

export const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- feedback

let toastTimer = 0;
export function toast(msg: string, ms = 3200) {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) { t = h('<div class="toast" role="status"></div>'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), ms);
}

export function busy(msg: string | null) {
  let b = document.querySelector<HTMLElement>('.busy');
  if (msg === null) { b?.remove(); return; }
  if (!b) { b = h('<div class="busy"><div class="spinner"></div><div class="busy-msg"></div></div>'); document.body.appendChild(b); }
  b.querySelector('.busy-msg')!.textContent = msg;
}

export function modal(title: string, body: HTMLElement | string, opts: { wide?: boolean; onClose?: () => void } = {}) {
  const m = h(`<div class="modal-back"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn icon-only close" title="Close">${icon('close')}</button></div>
    <div class="modal-body"></div></div></div>`);
  const bodyEl = m.querySelector('.modal-body')!;
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => { if (!m.isConnected) return; m.remove(); opts.onClose?.(); };
  m.querySelector('.close')!.addEventListener('click', close);
  m.addEventListener('pointerdown', (e) => { if (e.target === m) close(); });
  document.body.appendChild(m);
  return { el: m, body: bodyEl as HTMLElement, close };
}

export function confirmBox(text: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((res) => {
    const body = h(`<div><p class="lead">${esc(text)}</p><div class="row end">
      <button class="btn" data-a="no">Cancel</button>
      <button class="btn primary ${danger ? 'danger' : ''}" data-a="yes">${esc(okLabel)}</button></div></div>`);
    const m = modal('Please confirm', body);
    body.querySelector('[data-a=no]')!.addEventListener('click', () => { m.close(); res(false); });
    body.querySelector('[data-a=yes]')!.addEventListener('click', () => { m.close(); res(true); });
  });
}

export function promptBox(title: string, value: string): Promise<string | null> {
  return new Promise((res) => {
    const body = h(`<form><input class="input" type="text" maxlength="120"><div class="row end">
      <button type="button" class="btn" data-a="no">Cancel</button>
      <button type="submit" class="btn primary">Save</button></div></form>`);
    const input = body.querySelector('input')!;
    input.value = value;
    const m = modal(title, body);
    body.querySelector('[data-a=no]')!.addEventListener('click', () => { m.close(); res(null); });
    body.addEventListener('submit', (e) => { e.preventDefault(); m.close(); res(input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

