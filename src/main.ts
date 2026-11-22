import './styles.css';
import { icon } from './icons';
import { Editor } from './editor';
import { settings, saveSettings, toolState } from './settings';
import type { OpenedDoc, ToolId, ShapeKind, DocMeta } from './types';
import * as store from './store';
import { ACCEPT, importFiles, importBlob, templatePdf, addTemplatePage, type ImportResult, type Template } from './importers/index';
import { buildAnnotatedPdf, downloadBytes, shareFile, safeFileName, renderPagePng, makeThumb } from './export';
import { googleConfigured, pickFromDrive, downloadDriveFile, uploadToDrive } from './google';
import { PDFDocument, rgb } from 'pdf-lib';
import { drawAll } from './annotations';

const app = document.getElementById('app')!;
const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- feedback

let toastTimer = 0;
function toast(msg: string, ms = 3200) {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) { t = h('<div class="toast" role="status"></div>'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), ms);
}

function busy(msg: string | null) {
  let b = document.querySelector<HTMLElement>('.busy');
  if (msg === null) { b?.remove(); return; }
  if (!b) { b = h('<div class="busy"><div class="spinner"></div><div class="busy-msg"></div></div>'); document.body.appendChild(b); }
  b.querySelector('.busy-msg')!.textContent = msg;
}

function modal(title: string, body: HTMLElement | string, opts: { wide?: boolean } = {}) {
  const m = h(`<div class="modal-back"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn icon-only close" title="Close">${icon('close')}</button></div>
    <div class="modal-body"></div></div></div>`);
  const bodyEl = m.querySelector('.modal-body')!;
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => m.remove();
  m.querySelector('.close')!.addEventListener('click', close);
  m.addEventListener('pointerdown', (e) => { if (e.target === m) close(); });
  document.body.appendChild(m);
  return { el: m, body: bodyEl as HTMLElement, close };
}

function confirmBox(text: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((res) => {
    const body = h(`<div><p class="lead">${esc(text)}</p><div class="row end">
      <button class="btn" data-a="no">Cancel</button>
      <button class="btn primary ${danger ? 'danger' : ''}" data-a="yes">${esc(okLabel)}</button></div></div>`);
    const m = modal('Please confirm', body);
    body.querySelector('[data-a=no]')!.addEventListener('click', () => { m.close(); res(false); });
    body.querySelector('[data-a=yes]')!.addEventListener('click', () => { m.close(); res(true); });
  });
}

function promptBox(title: string, value: string): Promise<string | null> {
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

// ---------------------------------------------------------------- importing

const fileInput = h(`<input type="file" multiple accept="${ACCEPT}" hidden>`) as HTMLInputElement;
document.body.appendChild(fileInput);
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = '';
  if (files.length) handleFiles(files);
});

async function handleFiles(files: File[]) {
  try {
    busy('Opening…');
    const results = await importFiles(files, (m) => busy(m));
    let last: OpenedDoc | null = null;
    for (const r of results) last = await createDoc(r);
    busy(null);
    if (results.length > 1) toast(`${results.length} documents added to your library`);
    if (last) openEditor(last);
  } catch (e: any) {
    busy(null);
    console.error(e);
    modal('Could not open file', `<p class="lead">${esc(e?.message || String(e))}</p>`);
  }
}

async function createDoc(r: ImportResult): Promise<OpenedDoc> {
  const pdf = await PDFDocument.load(r.pdf, { ignoreEncryption: true }).catch(() => null);
  const now = Date.now();
  const doc: OpenedDoc = {
    meta: {
      id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      title: r.title || 'Untitled',
      source: r.source,
      created: now,
      updated: now,
      pageCount: pdf?.getPageCount() ?? 0,
    },
    pdf: r.pdf,
    pages: r.pages || [],
  };
  doc.meta.thumb = await makeThumb(doc);
  await store.saveDoc(doc);
  return doc;
}

async function openFromDrive() {
  if (!googleConfigured()) { showGoogleHelp(); return; }
  try {
    const picked = await pickFromDrive();
    if (!picked) return;
    busy(`Downloading “${picked.name}” from Google Drive…`);
    const f = await downloadDriveFile(picked);
    const r = await importBlob(f.blob, f.name, f.mime, (m) => busy(m));
    if (picked.mimeType.includes('presentation')) r.source = 'google-slides';
    else if (picked.mimeType.includes('document')) r.source = 'google-docs';
    const doc = await createDoc(r);
    busy(null);
    openEditor(doc);
  } catch (e: any) {
    busy(null);
    modal('Google Drive', `<p class="lead">${esc(e?.message || String(e))}</p>`);
  }
}

function showGoogleHelp() {
  modal('Open Google Docs & Slides', `
    <p class="lead">Google Drive isn't connected on this board yet. You can still open any Google file in two steps:</p>
    <ol class="steps">
      <li>In Google Docs, Slides or Sheets choose <b>File → Download → PDF document</b> (or .docx / .pptx).</li>
      <li>Here, tap <b>Open a file</b> and pick the download — or drag it onto this window.</li>
    </ol>
    <p>To open straight from Drive, an administrator can add a Google Cloud OAuth Client ID and API key in
    <b>Settings → Google Drive</b> (see the README for the 5-minute setup).</p>`);
}

window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) handleFiles(files);
});

// Files opened via the installed app ("Open with Anchor Ink")
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (p: any) => {
    const files: File[] = [];
    for (const fh of p.files || []) files.push(await fh.getFile());
    if (files.length) handleFiles(files);
  });
}

// ---------------------------------------------------------------- home

let editorCleanup: (() => Promise<void>) | null = null;

async function showHome() {
  if (editorCleanup) { const c = editorCleanup; editorCleanup = null; await c(); }
  document.body.dataset.screen = 'home';
  const docs = await store.listDocs();
  const tiles: [string, string, string, string][] = [
    ['open', 'file', 'Open a file', 'PDF · Word · PowerPoint · Images'],
    ['drive', 'cloud', 'Google Drive', 'Docs · Slides · Sheets · PDFs'],
    ['whiteboard', 'board', 'Whiteboard', 'Blank 16:9 page'],
    ['lined', 'lined', 'Lined paper', 'Handwriting practice'],
    ['graph', 'graph', 'Graph paper', 'Maths & plotting'],
    ['dots', 'dots', 'Dot grid', 'Geometry & sketching'],
  ];
  app.innerHTML = '';
  const home = h(`<main class="home">
    <header class="home-head">
      <div class="brand"><span class="logo">${icon('pen')}</span><div><h1>Anchor Ink</h1><p>Mark up anything. Your ink stays where you put it.</p></div></div>
      <div class="row">
        <button class="btn" data-a="fullscreen">${icon('fullscreen')}<span>Full screen</span></button>
        <button class="btn" data-a="settings">${icon('settings')}<span>Settings</span></button>
      </div>
    </header>
    <section class="tiles">${tiles.map(([a, ic, t, s]) => `
      <button class="tile ${a === 'open' ? 'primary' : ''}" data-a="${a}">
        <span class="tile-icon">${icon(ic)}</span><span class="tile-title">${t}</span><span class="tile-sub">${s}</span>
      </button>`).join('')}
    </section>
    <p class="hint">Tip: drag files from a USB drive or your desktop anywhere onto this screen.</p>
    <section class="recent">
      <h2>${docs.length ? 'Recent documents' : 'No documents yet'}</h2>
      <div class="cards">${docs.map(cardHtml).join('')}</div>
      ${docs.length ? '' : '<p class="empty">Open a file or start a whiteboard — everything you annotate is saved automatically on this board.</p>'}
    </section>
  </main>`);
  app.appendChild(home);
  home.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!btn) return;
    const a = btn.dataset.a!;
    if (a === 'open') fileInput.click();
    else if (a === 'drive') openFromDrive();
    else if (a === 'settings') showSettings();
    else if (a === 'fullscreen') toggleFullscreen();
    else if (['whiteboard', 'lined', 'graph', 'dots'].includes(a)) {
      const names: Record<string, string> = { whiteboard: 'Whiteboard', lined: 'Lined paper', graph: 'Graph paper', dots: 'Dot grid' };
      const doc = await createDoc({ title: `${names[a]} ${new Date().toLocaleDateString()}`, source: 'template:' + a, pdf: await templatePdf(a as Template) });
      openEditor(doc);
    } else if (a === 'doc') {
      const doc = await store.loadDoc(btn.dataset.id!);
      if (doc) openEditor(doc); else toast('That document could not be found.');
    } else if (a === 'delete') {
      e.stopPropagation();
      const title = btn.closest('.card')?.querySelector('.card-title')?.textContent || 'this document';
      if (await confirmBox(`Delete “${title}” from this board? This can't be undone.`, 'Delete', true)) {
        await store.deleteDoc(btn.dataset.id!);
        showHome();
      }
    }
  });
}

function cardHtml(d: DocMeta) {
  const when = new Date(d.updated);
  const sameDay = when.toDateString() === new Date().toDateString();
  const label = sameDay ? 'Today ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : when.toLocaleDateString();
  return `<div class="card">
    <button class="card-open" data-a="doc" data-id="${d.id}">
      <span class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : icon('file')}</span>
      <span class="card-title">${esc(d.title)}</span>
      <span class="card-sub">${label} · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}</span>
    </button>
    <button class="card-del" data-a="delete" data-id="${d.id}" title="Delete">${icon('trash')}</button>
  </div>`;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available in this browser.'));
}

// ---------------------------------------------------------------- settings

function showSettings() {
  const body = h(`<div class="settings">
    <h3>Toolbar</h3>
    <div class="seg" data-k="dockSide">
      <button data-v="left">Left side</button><button data-v="right">Right side</button>
    </div>
    <h3>Touch</h3>
    <div class="seg" data-k="drawWith">
      <button data-v="all">Fingers and pens draw<small>two fingers scroll &amp; zoom</small></button>
      <button data-v="pen">Only the pen draws<small>fingers scroll &amp; zoom</small></button>
    </div>
    <label class="check"><input type="checkbox" data-k="palmErase"> Wipe with palm or fist to erase (on boards that report touch size)</label>
    <h3>Google Drive <small>(optional)</small></h3>
    <p class="muted">Lets teachers open Google Docs / Slides / Sheets directly and save marked-up copies back to Drive. See README → “Google Drive setup”.</p>
    <label class="field">OAuth Client ID<input class="input" data-k="googleClientId" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
    <label class="field">API key<input class="input" data-k="googleApiKey" placeholder="AIza…"></label>
    <label class="field">Project number (App ID)<input class="input" data-k="googleAppId" placeholder="123456789012"></label>
    <h3>Storage</h3>
    <p class="muted storage-info">Checking…</p>
    <div class="row end"><button class="btn primary" data-a="done">Done</button></div>
  </div>`);
  const m = modal('Settings', body, { wide: true });
  const refresh = () => {
    body.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const k = seg.dataset.k as 'dockSide' | 'drawWith';
      seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[k]));
    });
  };
  refresh();
  body.querySelectorAll<HTMLElement>('.seg').forEach((seg) =>
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      (settings as any)[seg.dataset.k!] = b.dataset.v;
      saveSettings();
      refresh();
      applyDockSide();
    }),
  );
  const cb = body.querySelector<HTMLInputElement>('[data-k=palmErase]')!;
  cb.checked = settings.palmErase;
  cb.addEventListener('change', () => { settings.palmErase = cb.checked; saveSettings(); });
  body.querySelectorAll<HTMLInputElement>('input.input').forEach((inp) => {
    const k = inp.dataset.k as 'googleClientId' | 'googleApiKey' | 'googleAppId';
    inp.value = settings[k];
    inp.addEventListener('change', () => { settings[k] = inp.value.trim(); saveSettings(); });
  });
  body.querySelector('[data-a=done]')!.addEventListener('click', m.close);
  navigator.storage?.estimate?.().then((est) => {
    const mb = (n = 0) => (n / 1024 / 1024).toFixed(0) + ' MB';
    body.querySelector('.storage-info')!.textContent =
      `Documents are stored privately in this browser on this board (${mb(est.usage)} used of ${mb(est.quota)} available).`;
  });
}

let applyDockSide = () => {};

// ---------------------------------------------------------------- editor

const TOOLS: [ToolId, string, string][] = [
  ['hand', 'hand', 'Scroll'],
  ['select', 'select', 'Select'],
  ['pen', 'pen', 'Pen'],
  ['highlighter', 'highlighter', 'Highlight'],
  ['eraser', 'eraser', 'Eraser'],
  ['shape', 'shape', 'Shapes'],
  ['text', 'text', 'Text'],
  ['note', 'note', 'Sticky'],
  ['stamp', 'stamp', 'Stamp'],
  ['laser', 'laser', 'Laser'],
];
const PEN_COLORS = ['#111111', '#1e5bd8', '#d62828', '#2e9e44', '#f08c00', '#8e44ad', '#e84393', '#ffffff'];
const HL_COLORS = ['#ffeb3b', '#7cf29a', '#ff8fd0', '#7fd3ff', '#ffb347'];
const NOTE_COLORS = ['#fff59d', '#ffcc80', '#a5d6a7', '#90caf9', '#f48fb1', '#e1bee7'];
const STAMPS = ['✓', '✗', '★', '?', '!', '☺', '👍', '💯', '♥', '①', '②', '③', 'A+', '✓✓', '½', '→'];
const STAMP_COLORS = ['#2e7d32', '#d62828', '#f0a500', '#1e5bd8', '#8e44ad', '#111111'];
const SIZES: Record<string, number[]> = {
  pen: [3, 6, 11, 18, 30],
  highlighter: [16, 28, 44, 64],
  shape: [3, 6, 11, 18],
  text: [24, 36, 54, 80],
  eraser: [16, 30, 56, 96],
  stamp: [50, 90, 140, 220],
};

function openEditor(doc: OpenedDoc) {
  document.body.dataset.screen = 'editor';
  app.innerHTML = '';
  const root = h(`<div class="editor">
    <header class="topbar">
      <button class="btn" data-a="home">${icon('home')}<span>Library</span></button>
      <button class="title-btn" data-a="rename" title="Rename">${esc(doc.meta.title)} ${icon('edit')}</button>
      <span class="save-state" aria-live="polite">Saved</span>
      <div class="spacer"></div>
      <button class="btn" data-a="fullscreen" title="Full screen">${icon('fullscreen')}</button>
      <button class="btn primary" data-a="save">${icon('share')}<span>Save / Share</span></button>
    </header>
    <div class="stage"></div>
    <nav class="dock" aria-label="Tools">
      ${TOOLS.map(([id, ic, label]) => `<button class="tool" data-tool="${id}" title="${label}">${icon(ic)}<span>${label}</span><i class="swatch"></i></button>`).join('')}
      <hr>
      <button class="tool" data-a="undo" title="Undo">${icon('undo')}<span>Undo</span></button>
      <button class="tool" data-a="redo" title="Redo">${icon('redo')}<span>Redo</span></button>
      <hr>
      <button class="tool" data-a="save" title="Save / Share">${icon('download')}<span>Save</span></button>
      <button class="tool small" data-a="swap" title="Move toolbar to other side">${icon('swap')}</button>
    </nav>
    <div class="flyout" hidden></div>
    <nav class="pagebar" aria-label="Pages">
      <button class="btn icon-only" data-a="pages" title="All pages">${icon('grid')}</button>
      <button class="btn icon-only" data-a="prev" title="Previous page">${icon('up')}</button>
      <button class="page-label" data-a="goto">1 / 1</button>
      <button class="btn icon-only" data-a="next" title="Next page">${icon('down')}</button>
      <span class="sep"></span>
      <button class="btn icon-only" data-a="zoomOut" title="Zoom out">${icon('zoomOut')}</button>
      <button class="zoom-label" data-a="fit" title="Toggle fit width / whole page">100%</button>
      <button class="btn icon-only" data-a="zoomIn" title="Zoom in">${icon('zoomIn')}</button>
      <span class="sep"></span>
      <button class="btn icon-only" data-a="addPage" title="Add a blank page after this one">${icon('pagePlus')}</button>
    </nav>
  </div>`);
  app.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const stage = $('.stage');
  const dock = $('.dock');
  const flyout = $('.flyout');
  const saveState = $('.save-state');

  // --- autosave
  let saveTimer = 0;
  let dirty = false;
  const persist = async () => {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    doc.meta.updated = Date.now();
    doc.meta.pageCount = editor.viewer.pageCount;
    try {
      await store.saveAnnotations(doc.meta, doc.pages);
      saveState.textContent = 'Saved on this board';
      saveState.classList.remove('pending');
    } catch (e) {
      saveState.textContent = 'Not saved — storage full?';
      console.error(e);
    }
  };
  const markDirty = () => {
    dirty = true;
    saveState.textContent = 'Saving…';
    saveState.classList.add('pending');
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 700);
  };

  const editor = new Editor(stage, {
    onChange: () => { doc.pages = editor.viewer.annotations; markDirty(); },
    onHistory: () => {
      dock.querySelector<HTMLButtonElement>('[data-a=undo]')!.disabled = !editor.history.canUndo;
      dock.querySelector<HTMLButtonElement>('[data-a=redo]')!.disabled = !editor.history.canRedo;
    },
    onPage: () => updatePageLabel(),
    onZoom: () => updateZoomLabel(),
  });
  editor.history.clear();

  const updatePageLabel = () => {
    $('.page-label').textContent = `${editor.viewer.currentPage + 1} / ${editor.viewer.pageCount}`;
  };
  const updateZoomLabel = () => {
    const v = editor.viewer;
    $('.zoom-label').textContent = v.zoom === 1 ? (v.fitMode === 'width' ? 'Fit width' : 'Whole page') : Math.round(v.zoom * 100) + '%';
  };

  applyDockSide = () => {
    root.dataset.dock = settings.dockSide;
    const dw = dock.getBoundingClientRect().width + 32;
    editor.viewer.setSidePad(settings.dockSide === 'left' ? dw : 24, settings.dockSide === 'right' ? dw : 24);
  };

  busy('Opening document…');
  editor.viewer.open(doc.pdf, doc.pages).then(() => {
    busy(null);
    doc.pages = editor.viewer.annotations;
    applyDockSide();
    updatePageLabel();
    updateZoomLabel();
  }).catch((e) => {
    busy(null);
    console.error(e);
    modal('Could not open document', `<p class="lead">This file appears to be damaged or password-protected.</p><p class="muted">${esc(String(e?.message || e))}</p>`);
  });

  // --- tools
  const selectTool = (t: ToolId, toggleFlyout = false) => {
    const was = toolState.tool;
    editor.setTool(t);
    dock.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const hasOptions = ['pen', 'highlighter', 'eraser', 'shape', 'text', 'note', 'stamp'].includes(t);
    if (hasOptions && (was !== t || (toggleFlyout && flyout.hidden))) openFlyout(t);
    else if (toggleFlyout && was === t) flyout.hidden = !flyout.hidden;
    else if (!hasOptions) flyout.hidden = true;
    updateSwatches();
  };

  const updateSwatches = () => {
    const color: Partial<Record<ToolId, string>> = {
      pen: toolState.penColor, highlighter: toolState.hlColor, shape: toolState.shapeColor,
      text: toolState.textColor, note: toolState.noteColor, stamp: toolState.stampColor,
    };
    dock.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => {
      const c = color[b.dataset.tool as ToolId];
      (b.querySelector('.swatch') as HTMLElement).style.background = c || 'transparent';
    });
  };

  function colorRow(colors: string[], current: string, set: (c: string) => void) {
    const row = h(`<div class="swatches">${colors.map((c) => `<button class="sw ${c === current ? 'on' : ''}" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>`);
    row.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
      if (!b) return;
      set(b.dataset.c!);
      row.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s === b));
      updateSwatches();
    });
    return row;
  }
  function sizeRow(sizes: number[], current: number, set: (n: number) => void, preview: (n: number) => string) {
    const row = h(`<div class="sizes">${sizes.map((s) => `<button class="sz ${s === current ? 'on' : ''}" data-s="${s}">${preview(s)}</button>`).join('')}</div>`);
    row.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!b) return;
      set(Number(b.dataset.s));
      row.querySelectorAll('.sz').forEach((s) => s.classList.toggle('on', s === b));
    });
    return row;
  }
  const dot = (n: number, max: number) => `<i class="dot" style="width:${Math.max(4, (n / max) * 44)}px;height:${Math.max(4, (n / max) * 44)}px"></i>`;

  function openFlyout(t: ToolId) {
    flyout.innerHTML = '';
    flyout.hidden = false;
    const add = (el: HTMLElement | string) => flyout.appendChild(typeof el === 'string' ? h(el) : el);
    const T = toolState;
    if (t === 'pen') {
      add('<h4>Pen colour</h4>');
      add(colorRow(PEN_COLORS, T.penColor, (c) => (T.penColor = c)));
      add('<h4>Thickness</h4>');
      add(sizeRow(SIZES.pen, T.penSize, (n) => (T.penSize = n), (n) => dot(n, 30)));
    } else if (t === 'highlighter') {
      add('<h4>Highlighter</h4>');
      add(colorRow(HL_COLORS, T.hlColor, (c) => (T.hlColor = c)));
      add('<h4>Width</h4>');
      add(sizeRow(SIZES.highlighter, T.hlSize, (n) => (T.hlSize = n), (n) => dot(n, 64)));
    } else if (t === 'eraser') {
      add('<h4>Eraser size</h4>');
      add(sizeRow(SIZES.eraser, T.eraserSize, (n) => (T.eraserSize = n), (n) => `<i class="ring" style="width:${(n / 96) * 48 + 8}px;height:${(n / 96) * 48 + 8}px"></i>`));
      add('<p class="muted small">Touch any mark to remove it.</p>');
      const clr = h(`<button class="btn danger wide">${icon('trash')}<span>Clear this page</span></button>`);
      clr.addEventListener('click', async () => {
        const p = editor.viewer.currentPage;
        if (!(doc.pages[p] || []).length) { toast('This page has no annotations.'); return; }
        if (await confirmBox(`Remove all annotations from page ${p + 1}? (You can undo this.)`, 'Clear page', true)) editor.clearPage(p);
      });
      add(clr);
    } else if (t === 'shape') {
      add('<h4>Shape</h4>');
      const kinds: [ShapeKind, string][] = [
        ['line', '<svg viewBox="0 0 24 24"><path d="M4 20 20 4" /></svg>'],
        ['arrow', '<svg viewBox="0 0 24 24"><path d="M4 20 20 4M10 4h10v10" /></svg>'],
        ['rect', '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>'],
        ['ellipse', '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>'],
      ];
      const row = h(`<div class="sizes kinds">${kinds.map(([k, s]) => `<button class="sz ${k === T.shapeKind ? 'on' : ''}" data-k="${k}">${s}</button>`).join('')}</div>`);
      row.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
        if (!b) return;
        T.shapeKind = b.dataset.k as ShapeKind;
        row.querySelectorAll('.sz').forEach((s) => s.classList.toggle('on', s === b));
      });
      add(row);
      add('<h4>Colour</h4>');
      add(colorRow(PEN_COLORS, T.shapeColor, (c) => (T.shapeColor = c)));
      add('<h4>Line</h4>');
      add(sizeRow(SIZES.shape, T.shapeSize, (n) => (T.shapeSize = n), (n) => dot(n, 18)));
      const fill = h(`<label class="check"><input type="checkbox"> Tinted fill</label>`);
      const cb = fill.querySelector('input')!;
      cb.checked = T.shapeFill;
      cb.addEventListener('change', () => (T.shapeFill = cb.checked));
      add(fill);
    } else if (t === 'text') {
      add('<h4>Text colour</h4>');
      add(colorRow(PEN_COLORS, T.textColor, (c) => (T.textColor = c)));
      add('<h4>Size</h4>');
      add(sizeRow(SIZES.text, T.textSize, (n) => (T.textSize = n), (n) => `<b style="font-size:${12 + (n / 80) * 26}px">A</b>`));
      add('<p class="muted small">Tap the page to type. Tap text again to edit it.</p>');
    } else if (t === 'note') {
      add('<h4>Sticky note</h4>');
      add(colorRow(NOTE_COLORS, T.noteColor, (c) => (T.noteColor = c)));
      add('<p class="muted small">Tap the page to add a note. Use Select to move or resize it.</p>');
    } else if (t === 'stamp') {
      add('<h4>Stamp</h4>');
      const grid = h(`<div class="stamps">${STAMPS.map((s) => `<button class="st ${s === T.stamp ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>`);
      grid.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
        if (!b) return;
        T.stamp = b.dataset.s!;
        grid.querySelectorAll('.st').forEach((s) => s.classList.toggle('on', s === b));
      });
      add(grid);
      add('<h4>Colour</h4>');
      add(colorRow(STAMP_COLORS, T.stampColor, (c) => (T.stampColor = c)));
      add('<h4>Size</h4>');
      add(sizeRow(SIZES.stamp, T.stampSize, (n) => (T.stampSize = n), (n) => `<b style="font-size:${14 + (n / 220) * 26}px">★</b>`));
    }
    positionFlyout();
  }

  function positionFlyout() {
    const active = dock.querySelector<HTMLElement>('.tool.active');
    if (!active || flyout.hidden) return;
    const r = active.getBoundingClientRect();
    const fr = flyout.getBoundingClientRect();
    const top = Math.max(70, Math.min(window.innerHeight - fr.height - 16, r.top + r.height / 2 - fr.height / 2));
    flyout.style.top = top + 'px';
  }

  dock.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.tool) selectTool(b.dataset.tool as ToolId, true);
    else if (b.dataset.a === 'undo') editor.undo();
    else if (b.dataset.a === 'redo') editor.redo();
    else if (b.dataset.a === 'save') showSaveMenu();
    else if (b.dataset.a === 'swap') {
      settings.dockSide = settings.dockSide === 'left' ? 'right' : 'left';
      saveSettings();
      applyDockSide();
    }
  });
  // close the options panel when the teacher starts working on the page
  stage.addEventListener('pointerdown', () => { if (!flyout.hidden) flyout.hidden = true; }, true);

  // --- top & page bars
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b || b.closest('.dock')) return;
    const v = editor.viewer;
    switch (b.dataset.a) {
      case 'home': showHome(); break;
      case 'save': showSaveMenu(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'rename': {
        const t = await promptBox('Rename document', doc.meta.title);
        if (t) { doc.meta.title = t; b.innerHTML = `${esc(t)} ${icon('edit')}`; dirty = true; persist(); }
        break;
      }
      case 'prev': v.goToPage(v.targetPage - 1); break;
      case 'next': v.goToPage(v.targetPage + 1); break;
      case 'goto':
      case 'pages': showPages(); break;
      case 'zoomIn': v.setZoom(v.zoom * 1.25); break;
      case 'zoomOut': v.setZoom(v.zoom / 1.25); break;
      case 'fit': v.setFitMode(v.zoom !== 1 ? v.fitMode : v.fitMode === 'width' ? 'page' : 'width'); updateZoomLabel(); break;
      case 'addPage': addPage(); break;
    }
  });

  async function rebuildPdf(mutate: (pdf: PDFDocument) => Promise<void> | void, focusPage: number) {
    editor.finishEditing();
    await persist();
    busy('Updating pages…');
    try {
      const pdf = await PDFDocument.load(doc.pdf, { ignoreEncryption: true });
      await mutate(pdf);
      doc.pdf = await pdf.save();
      await store.saveDoc(doc);
      editor.history.clear();
      await editor.viewer.open(doc.pdf, doc.pages, true);
      doc.pages = editor.viewer.annotations;
      editor.viewer.goToPage(focusPage);
      updatePageLabel();
    } catch (e: any) {
      modal('Could not change pages', `<p class="lead">${esc(e?.message || String(e))}</p>`);
    } finally {
      busy(null);
    }
  }

  async function addPage() {
    const v = editor.viewer;
    const i = v.currentPage;
    const cur = v.pagesView[i];
    const tpl = (doc.meta.source.startsWith('template:') ? doc.meta.source.slice(9) : 'whiteboard') as Template;
    await rebuildPdf(async (pdf) => {
      if (doc.meta.source.startsWith('template:')) await addTemplatePage(pdf, tpl, i + 1, [cur.w, cur.h]);
      else {
        const p = pdf.insertPage(i + 1, [cur.w, cur.h]);
        p.drawRectangle({ x: 0, y: 0, width: cur.w, height: cur.h, color: rgb(1, 1, 1) });
      }
      doc.pages.splice(i + 1, 0, []);
    }, i + 1);
    toast(`Blank page added after page ${i + 1}`);
  }

  async function deletePage(i: number) {
    if (editor.viewer.pageCount <= 1) { toast("A document needs at least one page."); return; }
    if (!(await confirmBox(`Remove page ${i + 1} and its annotations from this document?`, 'Remove page', true))) return;
    await rebuildPdf((pdf) => { pdf.removePage(i); doc.pages.splice(i, 1); }, Math.max(0, i - 1));
  }

  function showPages() {
    const v = editor.viewer;
    const body = h(`<div><div class="page-grid">${v.pagesView.map((p) => `
      <div class="pg ${p.index === v.currentPage ? 'on' : ''}">
        <button class="pg-open" data-i="${p.index}"><canvas width="10" height="10"></canvas><span>${p.index + 1}${(doc.pages[p.index] || []).length ? ' ✎' : ''}</span></button>
        <button class="pg-del" data-del="${p.index}" title="Remove page">${icon('trash')}</button>
      </div>`).join('')}</div></div>`);
    const m = modal(`Pages (${v.pageCount})`, body, { wide: true });
    body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const del = t.closest<HTMLElement>('[data-del]');
      if (del) { m.close(); deletePage(Number(del.dataset.del)); return; }
      const open = t.closest<HTMLElement>('[data-i]');
      if (open) { m.close(); v.goToPage(Number(open.dataset.i)); }
    });
    // lazy thumbnails
    const io = new IntersectionObserver(async (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const btn = en.target as HTMLElement;
        const i = Number(btn.dataset.i);
        const pv = v.pagesView[i];
        if (!pv?.proxy) continue;
        const c = btn.querySelector('canvas')!;
        const s = 240 / Math.max(pv.w, pv.h);
        const vp = pv.proxy.getViewport({ scale: s });
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const ctx = c.getContext('2d')!;
        try { await pv.proxy.render({ canvas: c, canvasContext: ctx, viewport: vp, background: '#fff' }).promise; } catch { continue; }
        ctx.save();
        ctx.scale(s, s);
        drawAll(ctx, doc.pages[i] || []);
        ctx.restore();
      }
    }, { root: m.body });
    body.querySelectorAll('.pg-open').forEach((b) => io.observe(b));
    setTimeout(() => body.querySelector('.pg.on')?.scrollIntoView({ block: 'center' }), 50);
  }

  // --- save / share
  let driveFileId: string | undefined;
  async function getExport() {
    editor.finishEditing();
    await persist();
    busy('Preparing your PDF…');
    try {
      return await buildAnnotatedPdf(doc, (m) => busy(m));
    } finally {
      busy(null);
    }
  }

  function showSaveMenu() {
    const name = safeFileName(doc.meta.title) + '.pdf';
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] });
    const body = h(`<div class="save-menu">
      <p class="lead ok">${icon('check')} Everything is saved automatically on this board. Reopen it any time from the Library.</p>
      <div class="save-grid">
        <button class="tile" data-s="download">${icon('download')}<span class="tile-title">Download PDF</span><span class="tile-sub">Opens anywhere. Re-open it here to keep editing your ink.</span></button>
        <button class="tile" data-s="share">${icon(canShare ? 'share' : 'mail')}<span class="tile-title">${canShare ? 'Share / Email' : 'Email'}</span><span class="tile-sub">${canShare ? 'Send with Gmail, Outlook, Teams, Classroom…' : 'Downloads the PDF and opens a new email'}</span></button>
        <button class="tile" data-s="drive">${icon('cloud')}<span class="tile-title">Save to Google Drive</span><span class="tile-sub">${googleConfigured() ? 'Get a link to share or email' : 'Needs setup in Settings'}</span></button>
        <button class="tile" data-s="png">${icon('image')}<span class="tile-title">This page as image</span><span class="tile-sub">PNG of page ${editor.viewer.currentPage + 1} with your markup</span></button>
        <button class="tile" data-s="print">${icon('printer')}<span class="tile-title">Print</span><span class="tile-sub">Opens the marked-up PDF to print</span></button>
      </div></div>`);
    const m = modal('Save & share', body, { wide: true });
    body.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!b) return;
      const act = b.dataset.s;
      m.close();
      try {
        if (act === 'download') {
          downloadBytes(await getExport(), name);
          toast('PDF downloaded — check your Downloads folder.');
        } else if (act === 'share') {
          const bytes = await getExport();
          const r = await shareFile(bytes, name, doc.meta.title);
          if (r === 'unsupported') {
            downloadBytes(bytes, name);
            const subject = encodeURIComponent(doc.meta.title);
            const text = encodeURIComponent(`Hi,\n\nPlease find "${name}" attached.\n`);
            modal('Email', `<p class="lead">The PDF <b>${esc(name)}</b> has been downloaded.</p>
              <p>Attach it to your email from the Downloads folder.</p>
              <div class="row end"><a class="btn primary" href="mailto:?subject=${subject}&body=${text}">${icon('mail')}<span>Open email</span></a></div>`);
          }
        } else if (act === 'drive') {
          if (!googleConfigured()) { showGoogleHelp(); return; }
          const bytes = await getExport();
          busy('Uploading to Google Drive…');
          const res = await uploadToDrive(bytes, name, driveFileId);
          busy(null);
          driveFileId = res.id;
          const link = res.webViewLink;
          const subject = encodeURIComponent(doc.meta.title);
          const mailBody = encodeURIComponent(`Here is "${doc.meta.title}":\n${link}\n`);
          modal('Saved to Google Drive', `<p class="lead">${icon('check')} Saved as <b>${esc(name)}</b> in your Drive.</p>
            <p class="muted">Saving again updates the same file.</p>
            <div class="row end">
              <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open in Drive</a>
              <a class="btn primary" href="mailto:?subject=${subject}&body=${mailBody}">${icon('mail')}<span>Email link</span></a>
            </div>`);
        } else if (act === 'png') {
          busy('Rendering page…');
          const png = await renderPagePng(doc, editor.viewer.currentPage);
          busy(null);
          downloadBytes(png, `${safeFileName(doc.meta.title)} - page ${editor.viewer.currentPage + 1}.png`, 'image/png');
        } else if (act === 'print') {
          const bytes = await getExport();
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
          const w = window.open(url, '_blank');
          if (!w) downloadBytes(bytes, name);
          setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
        }
      } catch (err: any) {
        busy(null);
        console.error(err);
        modal('Something went wrong', `<p class="lead">${esc(err?.message || String(err))}</p>`);
      }
    });
  }

  selectTool(toolState.tool === 'laser' ? 'pen' : toolState.tool);
  flyout.hidden = true;
  window.addEventListener('resize', positionFlyout);

  editorCleanup = async () => {
    window.removeEventListener('resize', positionFlyout);
    editor.finishEditing();
    await persist();
    try {
      doc.meta.thumb = await makeThumb(doc);
      await store.saveMeta(doc.meta);
    } catch {}
    editor.destroy();
  };
  // save when the board goes to sleep / browser tab is hidden
  const onHide = () => { if (document.visibilityState === 'hidden') persist(); };
  document.addEventListener('visibilitychange', onHide);
  const prevCleanup = editorCleanup;
  editorCleanup = async () => { document.removeEventListener('visibilitychange', onHide); await prevCleanup(); };
}

// ---------------------------------------------------------------- boot

store.requestPersistence();
showHome();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
