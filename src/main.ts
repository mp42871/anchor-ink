import './styles.css';
import { icon } from './icons';
import { h, esc, toast, busy, modal, confirmBox, promptBox } from './ui';
import { Editor } from './editor';
import { settings, saveSettings, toolState } from './settings';
import type { OpenedDoc, ToolId, ShapeKind, DocMeta } from './types';
import * as store from './store';
import { ACCEPT, importFiles, importBlob, templatePdf, addTemplatePage, type ImportResult, type Template } from './importers/index';
import { buildAnnotatedPdf, downloadBytes, shareFile, safeFileName, renderPagePng, makeThumb } from './export';
import { googleConfigured, pickFromDrive, downloadDriveFile, uploadToDrive, driveAccount, connectDrive, disconnectDrive, preloadGoogle, setupLink, applySetupFromUrl } from './google';
import { showPenSetup } from './pensetup';
import { PDFDocument, rgb } from 'pdf-lib';
import { drawAll } from './annotations';

const app = document.getElementById('app')!;
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
    if (!driveAccount()) {
      const acct = await connectDrive();
      toast(`Connected to Google Drive${acct.email ? ' as ' + acct.email : ''}`);
      if (document.body.dataset.screen === 'home') showHome();
    }
    const picked = await pickFromDrive();
    if (!picked.length) return;
    let last: OpenedDoc | null = null;
    for (const [i, f] of picked.entries()) {
      busy(`Downloading “${f.name}” from Google Drive${picked.length > 1 ? ` (${i + 1} of ${picked.length})` : ''}…`);
      const dl = await downloadDriveFile(f);
      const r = await importBlob(dl.blob, dl.name, dl.mime, (m) => busy(m));
      if (f.mimeType.includes('presentation')) r.source = 'google-slides';
      else if (f.mimeType.includes('document')) r.source = 'google-docs';
      else if (f.mimeType.includes('spreadsheet')) r.source = 'google-sheets';
      last = await createDoc(r);
    }
    busy(null);
    if (picked.length > 1) toast(`${picked.length} documents added to your library`);
    if (last) openEditor(last);
  } catch (e: any) {
    busy(null);
    modal('Google Drive', `<p class="lead">${esc(e?.message || String(e))}</p>`);
  }
}

async function connectDriveUi() {
  try {
    const acct = await connectDrive();
    toast(`Connected to Google Drive${acct.email ? ' as ' + acct.email : ''}`);
    return acct;
  } catch (e: any) {
    modal('Google Drive', `<p class="lead">${esc(e?.message || String(e))}</p>`);
    return null;
  }
}

function showGoogleHelp() {
  const origin = location.origin;
  modal('Connect Google Drive', `
    <p class="lead">Google Drive needs a one-time setup for this site before teachers can press <b>Connect</b>.
    Google requires every app to register for its own sign-in key. It's free, takes about 10 minutes, and only needs doing once for your whole school.</p>
    <p><b>If your IT team already did this</b>, ask them for the Anchor Ink setup link and open it on this board. That's all.</p>
    <details class="setup-steps"><summary><b>I'm setting it up myself</b></summary>
    <ol class="steps">
      <li>Go to <b>console.cloud.google.com</b> with your school Google account and create a project called “Anchor Ink”.</li>
      <li><b>APIs &amp; Services → Library</b>: enable <b>Google Drive API</b> and <b>Google Picker API</b>.</li>
      <li><b>OAuth consent screen</b>: choose <b>Internal</b>, name it “Anchor Ink”, save.</li>
      <li><b>Credentials → Create credentials → OAuth client ID → Web application</b>. Under <i>Authorised JavaScript origins</i> add:<br><code class="copyable">${esc(origin)}</code></li>
      <li><b>Credentials → Create credentials → API key</b>.</li>
      <li>Paste the Client ID, the API key and your <b>project number</b> (on the project's Dashboard) into <b>Settings → Google Drive</b> here. Then use <b>Copy setup link</b> to set up every other board in one tap.</li>
    </ol></details>
    <p class="muted">Until then: in Google Docs or Slides choose <b>File → Download → PDF</b>, then tap <b>Open a file</b> here.</p>`, { wide: true });
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
  const acct = driveAccount();
  const driveSub = !googleConfigured()
    ? 'Set up Google Drive'
    : acct ? (acct.email || 'Connected') : 'Tap to connect your Drive';
  const tiles: [string, string, string, string][] = [
    ['open', 'file', 'Open a file', 'PDF · Word · PowerPoint · Images'],
    ['drive', 'cloud', acct ? 'Google Drive' : 'Connect Google Drive', driveSub],
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
        <button class="btn" data-a="pensetup">${icon('pen')}<span>Pen setup</span></button>
        <button class="btn" data-a="fullscreen">${icon('fullscreen')}<span>Full screen</span></button>
        <button class="btn" data-a="settings">${icon('settings')}<span>Settings</span></button>
      </div>
    </header>
    <section class="tiles">${tiles.map(([a, ic, t, s]) => `
      <button class="tile ${a === 'open' || (a === 'drive' && acct) ? 'primary' : ''}" data-a="${a}">
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
    else if (a === 'pensetup') showPenSetup();
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
    <h3>Pen &amp; touch</h3>
    <div class="seg" data-k="drawWith">
      <button data-v="auto">Automatic<small>pen writes; fingers scroll once the board can tell them apart</small></button>
      <button data-v="pen">Only the pen writes<small>fingers always scroll &amp; zoom</small></button>
      <button data-v="all">Pen and fingers write<small>two fingers scroll &amp; zoom</small></button>
    </div>
    <p class="muted pen-status"></p>
    <div class="row"><button class="btn" data-a="pensetup">${icon('pen')}<span>Pen setup &amp; test</span></button></div>
    <label class="check"><input type="checkbox" data-k="palmErase"> Wipe with palm or fist to erase (boards that report touch size)</label>
    <h3>Google Drive</h3>
    <div class="drive-status"></div>
    <details class="drive-admin"><summary>Administrator setup (Client ID / API key)</summary>
      <p class="muted">Add this site to <i>Authorised JavaScript origins</i>: <code>${esc(location.origin)}</code></p>
      <label class="field">OAuth Client ID<input class="input" data-k="googleClientId" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
      <label class="field">API key<input class="input" data-k="googleApiKey" placeholder="AIza…"></label>
      <label class="field">Project number (App ID)<input class="input" data-k="googleAppId" placeholder="123456789012"></label>
      <div class="row"><button class="btn" data-a="copylink">Copy setup link for other boards</button><button class="btn" data-a="drivehelp">Step-by-step guide</button></div>
    </details>
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
  const penStatus = () => {
    body.querySelector('.pen-status')!.textContent = settings.penMaxSize > 0
      ? 'Pen setup done: this board can tell the pen from a finger.'
      : 'Tip: run Pen setup so a resting hand never draws and fingers can scroll.';
  };
  penStatus();
  body.querySelector('[data-a=pensetup]')!.addEventListener('click', () => showPenSetup(() => { penStatus(); refresh(); }));
  const driveStatus = () => {
    const box = body.querySelector<HTMLElement>('.drive-status')!;
    const acct = driveAccount();
    if (!googleConfigured()) {
      box.innerHTML = '<p class="muted">Not set up on this board yet. Open <b>Administrator setup</b> below, or open the setup link from your IT team.</p>';
    } else if (acct) {
      box.innerHTML = `<div class="row"><span class="lead ok">${icon('check')} Connected${acct.email ? ' as <b>' + esc(acct.email) + '</b>' : ''}</span><button class="btn" data-a="disconnect">Disconnect</button></div>`;
      box.querySelector('[data-a=disconnect]')!.addEventListener('click', () => { disconnectDrive(); driveStatus(); });
    } else {
      box.innerHTML = `<div class="row"><button class="btn primary" data-a="connect">${icon('cloud')}<span>Connect Google Drive</span></button></div>`;
      box.querySelector('[data-a=connect]')!.addEventListener('click', async () => { await connectDriveUi(); driveStatus(); });
    }
  };
  driveStatus();
  body.querySelectorAll<HTMLInputElement>('input.input').forEach((inp) => inp.addEventListener('change', () => { preloadGoogle(); driveStatus(); }));
  body.querySelector('[data-a=copylink]')!.addEventListener('click', async () => {
    if (!googleConfigured()) { toast('Enter the Client ID and API key first.'); return; }
    const link = setupLink();
    try { await navigator.clipboard.writeText(link); toast('Setup link copied. Open it on each board (or email it to teachers).'); }
    catch { modal('Setup link', `<p>Open this link on each board:</p><p><code class="copyable">${esc(link)}</code></p>`); }
  });
  body.querySelector('[data-a=drivehelp]')!.addEventListener('click', showGoogleHelp);
  const onClose = () => { if (document.body.dataset.screen === 'home') showHome(); };
  body.querySelector('[data-a=done]')!.addEventListener('click', onClose);
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
    <div class="stage">
    <nav class="dock" aria-label="Tools">
      ${TOOLS.map(([id, ic, label]) => `<button class="tool" data-tool="${id}" title="${label}">${icon(ic)}<span>${label}</span><i class="swatch"></i></button>`).join('')}
      <button class="tool gap" data-a="undo" title="Undo">${icon('undo')}<span>Undo</span></button>
      <button class="tool" data-a="redo" title="Redo">${icon('redo')}<span>Redo</span></button>
      <button class="tool gap" data-a="save" title="Save / Share">${icon('download')}<span>Save</span></button>
      <button class="tool" data-a="swap" title="Move toolbar to other side">${icon('swap')}<span>Move</span></button>
    </nav>
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
    </div>
    <div class="flyout" hidden></div>
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

  let lastPad = '';
  applyDockSide = () => {
    root.dataset.dock = settings.dockSide;
    // wrap the toolbar into extra columns when the window is too short for one
    const tool = dock.querySelector<HTMLElement>('.tool')!;
    const th = tool.offsetHeight || 60;
    const rows = Math.max(3, Math.floor((stage.clientHeight - 32 + 3) / (th + 3)));
    const want = `repeat(${Math.min(rows, dock.children.length)}, ${th}px)`;
    if (dock.style.gridTemplateRows !== want) dock.style.gridTemplateRows = want;
    const dw = Math.round(dock.getBoundingClientRect().width);
    root.style.setProperty('--dockw', dw + 'px');
    // keep pages clear of the toolbar; narrow windows get tighter gutters
    const gutter = stage.clientWidth < 700 ? 8 : 24;
    const pad = dw + gutter + 14;
    const key = settings.dockSide + pad + gutter;
    if (key !== lastPad) {
      lastPad = key;
      editor.viewer.setSidePad(settings.dockSide === 'left' ? pad : gutter, settings.dockSide === 'right' ? pad : gutter);
    }
    positionFlyout();
  };
  // split screen / window resizing: toolbar may re-wrap, so re-measure everything
  const layoutRo = new ResizeObserver(() => applyDockSide());
  layoutRo.observe(stage);
  layoutRo.observe(dock);

  busy('Opening document…');
  editor.viewer.open(doc.pdf, doc.pages).then(() => {
    busy(null);
    doc.pages = editor.viewer.annotations;
    applyDockSide();
    updatePageLabel();
    updateZoomLabel();
    try {
      if (!settings.penMaxSize && settings.drawWith !== 'all' && !localStorage.getItem('anchor-ink-pen-hint')) {
        localStorage.setItem('anchor-ink-pen-hint', '1');
        toast('Write with the pen. Two fingers scroll and zoom. Tip: run “Pen setup” on the home screen so a resting hand never draws.', 7000);
      }
    } catch {}
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
    const dr = dock.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    flyout.style.maxHeight = sr.height - 24 + 'px';
    const fr = flyout.getBoundingClientRect();
    const top = Math.max(sr.top + 12, Math.min(sr.bottom - fr.height - 12, r.top + r.height / 2 - fr.height / 2));
    flyout.style.top = top + 'px';
    if (settings.dockSide === 'left') {
      flyout.style.left = Math.min(dr.right + 12, window.innerWidth - fr.width - 8) + 'px';
      flyout.style.right = '';
    } else {
      flyout.style.left = Math.max(8, dr.left - 12 - fr.width) + 'px';
      flyout.style.right = '';
    }
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
  stage.addEventListener('pointerdown', (e) => {
    if (!flyout.hidden && !(e.target as HTMLElement).closest('.dock, .pagebar')) flyout.hidden = true;
  }, true);

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
    layoutRo.disconnect();
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
function checkSetupLink() {
  if (!applySetupFromUrl()) return false;
  saveSettings();
  preloadGoogle();
  setTimeout(() => toast('Google Drive is set up on this board. Tap “Connect Google Drive” to sign in.', 6000), 300);
  return true;
}
checkSetupLink();
window.addEventListener('hashchange', () => { if (checkSetupLink() && document.body.dataset.screen === 'home') showHome(); });
preloadGoogle();
showHome();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
