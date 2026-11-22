import type { TemplateOpts } from './types';
import { MM, defaultTemplate, templatePdf, type Template } from './importers/index';
import { loadPdf, closePdf } from './pdfjs';
import { h, esc, modal } from './ui';

interface Preset { label: string; mm: number; style?: 'ruled' | 'primary' }

const PRESETS: Record<Exclude<Template, 'whiteboard'>, Preset[]> = {
  lined: [
    { label: 'Wide ruled', mm: 8.7, style: 'ruled' },
    { label: 'College ruled', mm: 7.1, style: 'ruled' },
    { label: 'Narrow ruled', mm: 6.4, style: 'ruled' },
    { label: 'Extra wide', mm: 12, style: 'ruled' },
    { label: 'Handwriting – small', mm: 12, style: 'primary' },
    { label: 'Handwriting – medium', mm: 19, style: 'primary' },
    { label: 'Handwriting – large', mm: 25, style: 'primary' },
  ],
  graph: [
    { label: '5 mm', mm: 5 },
    { label: '¼ inch', mm: 6.35 },
    { label: '1 cm', mm: 10 },
    { label: '½ inch', mm: 12.7 },
    { label: '2 cm', mm: 20 },
  ],
  dots: [
    { label: '5 mm', mm: 5 },
    { label: '¼ inch', mm: 6.35 },
    { label: '1 cm', mm: 10 },
    { label: '½ inch', mm: 12.7 },
    { label: '2 cm', mm: 20 },
  ],
};
const TITLES = { lined: 'Lined paper', graph: 'Graph paper', dots: 'Dot grid' };
const KEY = 'anchor-ink-paper-';

function lastChoice(kind: Exclude<Template, 'whiteboard'>): TemplateOpts {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + kind) || 'null');
    if (v && v.kind === kind && v.spacing > 0) return v;
  } catch {}
  return defaultTemplate(kind);
}

/** Ask for spacing / style / orientation of a new sheet. Resolves null if cancelled. */
export function choosePaper(kind: Exclude<Template, 'whiteboard'>): Promise<TemplateOpts | null> {
  return new Promise((resolve) => {
    const o: TemplateOpts = { ...lastChoice(kind) };
    const presets = PRESETS[kind];
    const body = h(`<div class="paper">
      <div class="paper-opts">
        <h3>${kind === 'lined' ? 'Line style' : kind === 'graph' ? 'Square size' : 'Dot spacing'}</h3>
        <div class="chips presets">${presets.map((p, i) => `<button data-i="${i}">${esc(p.label)}${kind === 'lined' ? `<small>${p.mm} mm</small>` : ''}</button>`).join('')}</div>
        <h3>Custom spacing <span class="mm-label"></span></h3>
        <input class="slider" type="range" min="3" max="40" step="0.5">
        <h3>Page</h3>
        <div class="chips orient"><button data-o="portrait">Portrait</button><button data-o="landscape">Landscape</button></div>
        <div class="row end"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="create">Create</button></div>
      </div>
      <div class="paper-preview"><canvas></canvas></div>
    </div>`);
    let done = false;
    const m = modal(`New ${TITLES[kind].toLowerCase()}`, body, { wide: true, onClose: () => { if (!done) resolve(null); } });
    const slider = body.querySelector<HTMLInputElement>('.slider')!;
    const mmLabel = body.querySelector<HTMLElement>('.mm-label')!;
    const canvas = body.querySelector('canvas')!;

    let renderToken = 0;
    const preview = async () => {
      const token = ++renderToken;
      const bytes = await templatePdf(o);
      if (token !== renderToken) return;
      const pdf = await loadPdf(bytes);
      try {
        const page = await pdf.getPage(1);
        const box = canvas.parentElement!.getBoundingClientRect();
        const vp1 = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, devicePixelRatio || 1);
        const fit = Math.min((box.width - 28) / vp1.width, (box.height - 28) / vp1.height);
        const vp = page.getViewport({ scale: fit * dpr });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.width = Math.round(vp1.width * fit) + 'px';
        canvas.style.height = Math.round(vp1.height * fit) + 'px';
        if (token === renderToken) await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      } finally {
        closePdf(pdf);
      }
    };

    const sync = () => {
      const mm = o.spacing / MM;
      slider.value = String(Math.round(mm * 2) / 2);
      mmLabel.textContent = `${(Math.round(mm * 10) / 10).toString()} mm`;
      body.querySelectorAll<HTMLElement>('.presets button').forEach((b) => {
        const p = presets[Number(b.dataset.i)];
        b.classList.toggle('on', Math.abs(p.mm - mm) < 0.05 && (kind !== 'lined' || p.style === (o.style || 'ruled')));
      });
      body.querySelectorAll<HTMLElement>('.orient button').forEach((b) => b.classList.toggle('on', b.dataset.o === o.orientation));
      preview();
    };

    body.querySelector('.presets')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!b) return;
      const p = presets[Number(b.dataset.i)];
      o.spacing = p.mm * MM;
      if (p.style) o.style = p.style;
      sync();
    });
    slider.addEventListener('input', () => { o.spacing = Number(slider.value) * MM; sync(); });
    body.querySelector('.orient')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-o]');
      if (!b) return;
      o.orientation = b.dataset.o as TemplateOpts['orientation'];
      sync();
    });
    body.querySelector('[data-a=cancel]')!.addEventListener('click', () => m.close());
    body.querySelector('[data-a=create]')!.addEventListener('click', () => {
      done = true;
      try { localStorage.setItem(KEY + kind, JSON.stringify(o)); } catch {}
      m.close();
      resolve(o);
    });
    requestAnimationFrame(sync);
  });
}

export function describePaper(o: TemplateOpts) {
  if (o.kind === 'whiteboard') return 'Whiteboard';
  const mm = Math.round((o.spacing / MM) * 10) / 10;
  const name = o.kind === 'lined' ? (o.style === 'primary' ? 'Handwriting paper' : 'Lined paper') : TITLES[o.kind];
  return `${name} ${mm} mm`;
}
