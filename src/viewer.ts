import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs';
import { loadPdf, closePdf } from './pdfjs';
import type { Annotation, Rect } from './types';
import { drawAll, bbox } from './annotations';

const MAX_CANVAS_PIXELS = 9_000_000;
const GAP = 28; // px between pages

export interface PageView {
  index: number;
  w: number; // page units
  h: number;
  el: HTMLDivElement;
  base: HTMLCanvasElement | null;
  ann: HTMLCanvasElement | null;
  renderedScale: number;
  renderTask: any;
  near: boolean;
  proxy?: PDFPageProxy;
}

export type FitMode = 'width' | 'page';

/**
 * Continuous-scroll page viewer. Each page is a DOM box sized to
 * (page size × scale). The PDF raster and the annotation layer live INSIDE that
 * box, so they always move together when the document scrolls or zooms.
 */
export class Viewer {
  readonly scroller: HTMLDivElement;
  readonly inner: HTMLDivElement;
  pdf: PDFDocumentProxy | null = null;
  pagesView: PageView[] = [];
  annotations: Annotation[][] = [];
  scale = 1;
  zoom = 1;
  fitMode: FitMode = 'width';
  sidePad = { left: 24, right: 24 };
  /** annotation ids hidden from the static layer (e.g. while being edited) */
  hidden = new Set<string>();
  onPageChange: (i: number) => void = () => {};
  onZoomChange: () => void = () => {};
  currentPage = 0;

  private io: IntersectionObserver | null = null;
  private renderTimer = 0;
  private ro: ResizeObserver;
  private destroyed = false;

  constructor(parent: HTMLElement) {
    this.scroller = document.createElement('div');
    this.scroller.className = 'scroller';
    this.inner = document.createElement('div');
    this.inner.className = 'pages';
    this.inner.style.gap = GAP + 'px';
    this.scroller.appendChild(this.inner);
    parent.appendChild(this.scroller);
    this.scroller.addEventListener('scroll', () => this.updateCurrentPage(), { passive: true });
    let lastW = 0, lastH = 0;
    this.ro = new ResizeObserver(() => {
      const w = this.scroller.clientWidth, h = this.scroller.clientHeight;
      if (!this.pdf || (w === lastW && h === lastH)) return;
      lastW = w; lastH = h;
      this.relayout();
    });
    this.ro.observe(this.scroller);
  }

  async open(bytes: Uint8Array, annotations: Annotation[][], keepPosition = false) {
    const pos = keepPosition ? this.capturePosition() : null;
    closePdf(this.pdf);
    this.io?.disconnect();
    this.inner.innerHTML = '';
    this.pagesView = [];
    const pdf = await loadPdf(bytes);
    if (this.destroyed) { closePdf(pdf); return; }
    this.pdf = pdf;
    const n = pdf.numPages;
    while (annotations.length < n) annotations.push([]);
    if (annotations.length > n) annotations.length = n;
    this.annotations = annotations;
    // read every page size (cheap: no rendering)
    const sizes = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        pdf.getPage(i + 1).then((p) => {
          const vp = p.getViewport({ scale: 1 });
          return { w: vp.width, h: vp.height, proxy: p };
        }),
      ),
    );
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.scroller,
      rootMargin: '120% 60% 120% 60%',
    });
    sizes.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.index = String(i);
      const pv: PageView = { index: i, w: s.w, h: s.h, el, base: null, ann: null, renderedScale: 0, renderTask: null, near: false, proxy: s.proxy };
      this.pagesView.push(pv);
      this.inner.appendChild(el);
      this.io!.observe(el);
    });
    this.relayout(false);
    if (pos) this.restorePosition(pos);
    else this.scroller.scrollTo(0, 0);
    this.updateCurrentPage();
  }

  destroy() {
    this.destroyed = true;
    this.io?.disconnect();
    this.ro.disconnect();
    this.pagesView.forEach((p) => p.renderTask?.cancel());
    closePdf(this.pdf);
    this.scroller.remove();
  }

  get pageCount() { return this.pagesView.length; }

  // ---------- layout & zoom ----------

  fitScale() {
    if (!this.pagesView.length) return 1;
    const availW = Math.max(200, this.scroller.clientWidth - this.sidePad.left - this.sidePad.right);
    const availH = Math.max(200, this.scroller.clientHeight - 2 * GAP);
    const maxW = Math.max(...this.pagesView.map((p) => p.w));
    const cur = this.pagesView[this.currentPage] || this.pagesView[0];
    const byW = availW / maxW;
    return this.fitMode === 'width' ? byW : Math.min(byW, availH / cur.h);
  }

  relayout(keep = true) {
    const pos = keep ? this.capturePosition() : null;
    this.scale = this.fitScale() * this.zoom;
    this.inner.style.paddingLeft = this.sidePad.left + 'px';
    this.inner.style.paddingRight = this.sidePad.right + 'px';
    for (const p of this.pagesView) {
      p.el.style.width = p.w * this.scale + 'px';
      p.el.style.height = p.h * this.scale + 'px';
    }
    if (pos) this.restorePosition(pos);
    this.scheduleRender();
    this.onZoomChange();
  }

  setSidePad(left: number, right: number) {
    this.sidePad = { left, right };
    if (this.pdf) this.relayout();
  }

  /** Zoom keeping the page point under (clientX, clientY) fixed on screen. */
  setZoom(z: number, clientX?: number, clientY?: number) {
    z = Math.max(0.25, Math.min(8, z));
    if (Math.abs(z - this.zoom) < 1e-4) return;
    const r = this.scroller.getBoundingClientRect();
    const cx = clientX ?? r.left + r.width / 2;
    const cy = clientY ?? r.top + r.height / 2;
    const anchor = this.locate(cx, cy, true);
    this.zoom = z;
    this.relayout(false);
    if (anchor) {
      const pr = this.pagesView[anchor.page].el.getBoundingClientRect();
      this.scroller.scrollLeft += pr.left + anchor.x * this.scale - cx;
      this.scroller.scrollTop += pr.top + anchor.y * this.scale - cy;
    }
    this.updateCurrentPage();
  }

  setFitMode(m: FitMode) {
    this.fitMode = m;
    this.zoom = 1;
    const cur = this.currentPage;
    this.relayout(false);
    this.goToPage(cur, false);
  }

  private capturePosition() {
    const r = this.scroller.getBoundingClientRect();
    return this.locate(r.left + r.width / 2, r.top + Math.min(80, r.height / 3), true);
  }
  private restorePosition(a: { page: number; x: number; y: number } | null) {
    if (!a || !this.pagesView[a.page]) return;
    const r = this.scroller.getBoundingClientRect();
    const pr = this.pagesView[a.page].el.getBoundingClientRect();
    this.scroller.scrollLeft += pr.left + a.x * this.scale - (r.left + r.width / 2);
    this.scroller.scrollTop += pr.top + a.y * this.scale - (r.top + Math.min(80, r.height / 3));
  }

  // ---------- coordinates ----------

  /**
   * Map a screen point to (page, x, y) in page units. With `nearest`, points in
   * the gaps between pages resolve to the closest page.
   */
  locate(clientX: number, clientY: number, nearest = false): { page: number; x: number; y: number } | null {
    let best: { page: number; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const p of this.pagesView) {
      const r = p.el.getBoundingClientRect();
      const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      const loc = { page: p.index, x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
      if (inside) return loc;
      if (nearest) {
        const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        const d = dy * 4 + dx;
        if (d < bestD) { bestD = d; best = loc; }
      }
    }
    return best;
  }

  pageToClient(page: number, x: number, y: number) {
    const r = this.pagesView[page].el.getBoundingClientRect();
    return { x: r.left + x * this.scale, y: r.top + y * this.scale };
  }

  // ---------- navigation ----------

  private updateCurrentPage() {
    if (this.navTarget !== null) return;
    const r = this.scroller.getBoundingClientRect();
    const mid = r.top + r.height * 0.4;
    let cur = this.currentPage;
    for (const p of this.pagesView) {
      const pr = p.el.getBoundingClientRect();
      if (pr.top <= mid && pr.bottom + GAP >= mid) { cur = p.index; break; }
    }
    if (this.scroller.scrollTop <= 2) cur = 0;
    else if (this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 2)
      cur = this.pagesView.length - 1;
    if (cur !== this.currentPage) {
      this.currentPage = cur;
      this.onPageChange(cur);
    }
  }

  /** page we are smooth-scrolling towards, so rapid next/prev taps add up */
  private navTarget: number | null = null;
  private navTimer = 0;

  get targetPage() { return this.navTarget ?? this.currentPage; }

  goToPage(i: number, smooth = true) {
    const p = this.pagesView[Math.max(0, Math.min(this.pagesView.length - 1, i))];
    if (!p) return;
    const top = p.el.offsetTop - GAP / 2;
    this.scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    this.currentPage = p.index;
    this.onPageChange(p.index);
    this.navTarget = smooth ? p.index : null;
    clearTimeout(this.navTimer);
    if (smooth) this.navTimer = window.setTimeout(() => { this.navTarget = null; this.updateCurrentPage(); }, 900);
  }

  scrollByScreens(dir: number) {
    this.scroller.scrollBy({ top: dir * this.scroller.clientHeight * 0.8, behavior: 'smooth' });
  }

  // ---------- rendering ----------

  private onIntersect(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      const pv = this.pagesView[Number((e.target as HTMLElement).dataset.index)];
      if (!pv) continue;
      pv.near = e.isIntersecting;
      if (!pv.near) this.release(pv);
    }
    this.scheduleRender(0);
  }

  scheduleRender(delay = 120) {
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.renderNear(), delay);
  }

  private backingScale(p: PageView) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let s = this.scale * dpr;
    const px = p.w * s * p.h * s;
    if (px > MAX_CANVAS_PIXELS) s *= Math.sqrt(MAX_CANVAS_PIXELS / px);
    return s;
  }

  private renderNear() {
    // visible pages first, then those in the pre-load margin
    const r = this.scroller.getBoundingClientRect();
    const near = this.pagesView.filter((p) => p.near);
    near.sort((a, b) => {
      const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      const va = ra.bottom > r.top && ra.top < r.bottom ? 0 : 1;
      const vb = rb.bottom > r.top && rb.top < r.bottom ? 0 : 1;
      return va - vb || Math.abs(ra.top - r.top) - Math.abs(rb.top - r.top);
    });
    (async () => {
      for (const p of near) {
        if (this.destroyed) return;
        await this.renderBase(p);
        this.drawAnnotations(p.index);
      }
    })();
  }

  private async renderBase(p: PageView) {
    const s = this.backingScale(p);
    if (p.base && Math.abs(p.renderedScale - s) / s < 0.05) return;
    if (!this.pdf || !p.proxy) return;
    p.renderTask?.cancel();
    const vp = p.proxy.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.className = 'base';
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const task = p.proxy.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp, background: '#ffffff' });
    p.renderTask = task;
    try {
      await task.promise;
    } catch {
      return; // cancelled
    }
    if (p.renderTask !== task) return;
    p.renderTask = null;
    if (!p.near) return;
    if (p.base) { p.base.width = 0; p.base.remove(); }
    p.base = c;
    p.renderedScale = s;
    p.el.insertBefore(c, p.el.firstChild);
  }

  private release(p: PageView) {
    p.renderTask?.cancel();
    p.renderTask = null;
    if (p.base) { p.base.width = p.base.height = 0; p.base.remove(); p.base = null; }
    if (p.ann) { p.ann.width = p.ann.height = 0; p.ann.remove(); p.ann = null; }
    p.renderedScale = 0;
  }

  /** Redraw the committed annotation layer of one page. */
  drawAnnotations(index: number) {
    const p = this.pagesView[index];
    if (!p || !p.near) return;
    const anns = this.annotations[index] || [];
    if (!anns.length) {
      if (p.ann) { p.ann.width = p.ann.height = 0; p.ann.remove(); p.ann = null; }
      return;
    }
    const s = this.backingScale(p);
    if (!p.ann) {
      p.ann = document.createElement('canvas');
      p.ann.className = 'ann';
      p.el.appendChild(p.ann);
    }
    const W = Math.floor(p.w * s), H = Math.floor(p.h * s);
    if (p.ann.width !== W || p.ann.height !== H) { p.ann.width = W; p.ann.height = H; }
    const ctx = p.ann.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(W / p.w, 0, 0, H / p.h, 0, 0);
    drawAll(ctx, anns, this.hidden.size ? this.hidden : undefined);
  }

  redrawAll() {
    for (const p of this.pagesView) if (p.near) this.drawAnnotations(p.index);
  }

  /** A temporary canvas placed over a page for live drawing feedback. */
  createLiveLayer(index: number) {
    const p = this.pagesView[index];
    const c = document.createElement('canvas');
    c.className = 'live';
    const s = this.backingScale(p);
    c.width = Math.floor(p.w * s);
    c.height = Math.floor(p.h * s);
    p.el.appendChild(c);
    // desynchronized = low-latency path (draws without waiting for the compositor)
    const ctx = (c.getContext('2d', { desynchronized: true }) || c.getContext('2d'))!;
    const reset = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(c.width / p.w, 0, 0, c.height / p.h, 0, 0);
    };
    return { canvas: c, ctx, reset, remove: () => { c.width = c.height = 0; c.remove(); } };
  }

  selectionRect(index: number, ids: Set<string>): Rect | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of this.annotations[index] || []) {
      if (!ids.has(a.id)) continue;
      const b = bbox(a);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}
