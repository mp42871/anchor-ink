import { Viewer } from './viewer';
import { History } from './history';
import { settings, toolState } from './settings';
import { classify, fingerDraws, type Contact } from './input';
import type { Annotation, NoteAnn, ShapeAnn, StampAnn, StrokeAnn, TextAnn, ToolId } from './types';
import { bbox, drawAnnotation, eraseFromStroke, hitTest, newId, rectsIntersect, scaled, translated, FONT_STACK } from './annotations';

interface Action {
  started: number;
  /** filled in by down(): what started it and where */
  kind?: Contact;
  sx?: number;
  sy?: number;
  travel?: number;
  pointerId: number;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

interface Gesture {
  ids: Set<number>;
  cx: number;
  cy: number;
  dist: number;
  samples: { t: number; x: number; y: number }[];
}

type Pt = { x: number; y: number; type: string };

export interface EditorCallbacks {
  onChange(page: number): void;
  onHistory(): void;
  onPage(i: number): void;
  onZoom(): void;
}

/**
 * Turns pointer input into annotations. One finger/pen = the current tool,
 * two fingers = scroll & pinch-zoom (so a teacher never has to switch tools
 * just to move around the document).
 */
export class Editor {
  viewer: Viewer;
  history: History;
  private pointers = new Map<number, Pt>();
  private action: Action | null = null;
  private gesture: Gesture | null = null;
  private momentumRaf = 0;
  private selection: { page: number; ids: Set<string> } | null = null;
  private selBox: HTMLDivElement | null = null;
  private editing: { page: number; ann: TextAnn | NoteAnn; isNew: boolean; before: Annotation[]; el: HTMLTextAreaElement } | null = null;
  private laser: HTMLCanvasElement;
  private laserTrails: { pts: { x: number; y: number; t: number }[] }[] = [];
  private laserRaf = 0;
  private eraserRing: HTMLDivElement;
  private lastTap = { t: 0, x: 0, y: 0 };
  private detach: (() => void)[] = [];

  constructor(parent: HTMLElement, private cb: EditorCallbacks) {
    this.viewer = new Viewer(parent);
    this.viewer.onPageChange = (i) => cb.onPage(i);
    this.viewer.onZoomChange = () => {
      this.positionSelection();
      this.positionEditor();
      cb.onZoom();
    };
    this.history = new History(
      (page, anns) => {
        this.clearSelection();
        this.viewer.annotations[page] = anns;
        this.viewer.drawAnnotations(page);
        cb.onChange(page);
      },
      () => cb.onHistory(),
    );

    this.laser = document.createElement('canvas');
    this.laser.className = 'laser-layer';
    parent.appendChild(this.laser);
    this.eraserRing = document.createElement('div');
    this.eraserRing.className = 'eraser-ring';
    parent.appendChild(this.eraserRing);

    const s = this.viewer.scroller;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, k: K, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(k, fn, opts);
      this.detach.push(() => el.removeEventListener(k, fn, opts));
    };
    on(s, 'pointerdown', (e) => this.down(e));
    on(s, 'pointermove', (e) => this.move(e));
    on(s, 'pointerup', (e) => this.up(e));
    on(s, 'pointercancel', (e) => this.up(e, true));
    on(s, 'contextmenu', (e) => e.preventDefault());
    on(s, 'wheel', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.viewer.setZoom(this.viewer.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      }
    }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.key(e));
  }

  destroy() {
    this.finishEditing();
    this.detach.forEach((d) => d());
    cancelAnimationFrame(this.momentumRaf);
    cancelAnimationFrame(this.laserRaf);
    this.laser.remove();
    this.eraserRing.remove();
    this.viewer.destroy();
  }

  get anns() { return this.viewer.annotations; }

  commit(page: number, before: Annotation[], after: Annotation[]) {
    this.viewer.annotations[page] = after;
    this.history.push(page, before, after);
    this.viewer.drawAnnotations(page);
    this.cb.onChange(page);
  }

  setTool(t: ToolId) {
    this.finishEditing();
    if (t !== 'select') this.clearSelection();
    toolState.tool = t;
    this.viewer.scroller.dataset.activeTool = t;
  }

  undo() { this.finishEditing(); const p = this.history.undo(); if (p !== undefined) this.revealPage(p); }
  redo() { this.finishEditing(); const p = this.history.redo(); if (p !== undefined) this.revealPage(p); }

  private revealPage(p: number) {
    const r = this.viewer.pagesView[p]?.el.getBoundingClientRect();
    const sr = this.viewer.scroller.getBoundingClientRect();
    if (r && (r.bottom < sr.top || r.top > sr.bottom)) this.viewer.goToPage(p);
  }

  clearPage(page: number) {
    this.finishEditing();
    this.clearSelection();
    const before = this.anns[page] || [];
    if (before.length) this.commit(page, before, []);
  }

  // ---------------- pointer plumbing ----------------

  private isUi(e: PointerEvent) {
    return !!(e.target as HTMLElement).closest?.('.text-editor, .sel-bar');
  }

  private down(e: PointerEvent) {
    if (this.isUi(e)) return;
    e.preventDefault();
    const kind = classify(e);
    const tool = toolState.tool;
    const inkTool = tool === 'pen' || tool === 'highlighter';

    // A resting hand / palm never draws or scrolls (optionally it erases).
    if (kind === 'palm') {
      if (settings.palmErase && inkTool && !this.action && !this.gesture) {
        this.capture(e);
        this.action = this.tag(this.eraserAction(e, Math.max(e.width, e.height) / 2), e, kind);
      }
      return;
    }

    cancelAnimationFrame(this.momentumRaf);

    if (this.editing) {
      // tapping elsewhere finishes typing (and does nothing else)
      this.finishEditing();
      return;
    }

    if (this.action) {
      const a = this.action;
      // While the pen is writing, any other contact is the teacher's hand: ignore it.
      if (a.kind === 'pen' || kind === 'pen') return;
      // Two fingers landing together = scroll / zoom, so undo the first finger's mark.
      if (kind === 'finger' && performance.now() - a.started < 260 && (a.travel ?? 0) < 40) {
        this.capture(e);
        const first = a.pointerId;
        a.cancel();
        this.action = null;
        this.startGesture([first, e.pointerId]);
      }
      return;
    }

    if (this.gesture) {
      if (kind === 'pen') {
        // pen wins: stop scrolling and write
        this.gesture = null;
      } else {
        this.capture(e);
        this.addToGesture(e.pointerId);
        return;
      }
    }

    this.capture(e);
    // Stylus eraser end, or barrel button held → erase.
    if (e.pointerType === 'pen' && ((e.buttons & 32) || e.button === 5 || e.button === 2)) {
      this.action = this.tag(this.eraserAction(e, toolState.eraserSize), e, kind);
      return;
    }
    const pan =
      (kind === 'mouse' && (e.button === 1 || e.button === 2)) ||
      tool === 'hand' ||
      (kind === 'finger' && !fingerDraws());
    if (pan) { this.startGesture([e.pointerId]); return; }
    const act = this.startTool(tool, e);
    this.action = act ? this.tag(act, e, kind) : null;
  }

  private capture(e: PointerEvent) {
    try { this.viewer.scroller.setPointerCapture(e.pointerId); } catch {}
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  }

  private tag(a: Action, e: PointerEvent, kind: Contact): Action {
    a.kind = kind;
    a.sx = e.clientX;
    a.sy = e.clientY;
    a.travel = 0;
    return a;
  }

  private move(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (toolState.tool === 'eraser' && e.pointerType === 'mouse') this.showRing(e.clientX, e.clientY);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (this.gesture?.ids.has(e.pointerId)) this.updateGesture();
    else if (this.action?.pointerId === e.pointerId) {
      const a = this.action;
      a.travel = Math.max(a.travel ?? 0, Math.hypot(e.clientX - (a.sx ?? 0), e.clientY - (a.sy ?? 0)));
      a.move(e);
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.gesture?.ids.has(e.pointerId)) {
      this.gesture.ids.delete(e.pointerId);
      if (!this.gesture.ids.size) {
        const g = this.gesture;
        this.gesture = null;
        this.momentum(g);
      } else this.resetGestureBase();
    } else if (this.action?.pointerId === e.pointerId) {
      const a = this.action;
      this.action = null;
      if (cancelled && performance.now() - a.started < 120) a.cancel();
      else a.up(e);
    }
  }

  // ---------------- scroll / pinch gesture ----------------

  private startGesture(ids: number[]) {
    this.gesture = { ids: new Set(ids.filter((i) => this.pointers.has(i))), cx: 0, cy: 0, dist: 0, samples: [] };
    this.resetGestureBase();
  }
  private addToGesture(id: number) {
    this.gesture!.ids.add(id);
    this.resetGestureBase();
  }
  private centroid() {
    const pts = [...this.gesture!.ids].map((i) => this.pointers.get(i)!).filter(Boolean);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist, n: pts.length };
  }
  private resetGestureBase() {
    const g = this.gesture!;
    const c = this.centroid();
    g.cx = c.cx; g.cy = c.cy; g.dist = c.dist;
    g.samples = [];
  }
  private updateGesture() {
    const g = this.gesture!;
    const c = this.centroid();
    if (!c.n) return;
    const s = this.viewer.scroller;
    if (c.n > 1 && g.dist > 0 && c.dist > 0) {
      const ratio = c.dist / g.dist;
      if (Math.abs(ratio - 1) > 0.002) this.viewer.setZoom(this.viewer.zoom * ratio, c.cx, c.cy);
    }
    s.scrollLeft -= c.cx - g.cx;
    s.scrollTop -= c.cy - g.cy;
    g.cx = c.cx; g.cy = c.cy; g.dist = c.dist;
    const t = performance.now();
    g.samples.push({ t, x: c.cx, y: c.cy });
    while (g.samples.length && t - g.samples[0].t > 90) g.samples.shift();
  }
  private momentum(g: Gesture) {
    if (g.samples.length < 2) return;
    const a = g.samples[0], b = g.samples[g.samples.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 60) return;
    let vx = ((b.x - a.x) / dt) * 16, vy = ((b.y - a.y) / dt) * 16;
    const s = this.viewer.scroller;
    const step = () => {
      vx *= 0.95; vy *= 0.95;
      if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) return;
      s.scrollLeft -= vx;
      s.scrollTop -= vy;
      this.momentumRaf = requestAnimationFrame(step);
    };
    this.momentumRaf = requestAnimationFrame(step);
  }

  // ---------------- tools ----------------

  private startTool(tool: ToolId, e: PointerEvent): Action | null {
    switch (tool) {
      case 'pen':
      case 'highlighter':
        return this.strokeAction(e, tool);
      case 'eraser':
        return this.eraserAction(e, toolState.eraserSize);
      case 'shape':
        return this.shapeAction(e);
      case 'laser':
        return this.laserAction(e);
      case 'select':
        return this.selectAction(e);
      case 'text':
      case 'note':
      case 'stamp':
        return this.tapAction(e, tool);
      default:
        return null;
    }
  }

  private events(e: PointerEvent): PointerEvent[] {
    const c = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
    return c && c.length ? c : [e];
  }

  private strokeAction(e: PointerEvent, type: 'pen' | 'highlighter'): Action | null {
    const loc = this.viewer.locate(e.clientX, e.clientY, true);
    if (!loc) return null;
    const v = this.viewer;
    const page = loc.page;
    const realPressure = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
    const ann: StrokeAnn = {
      id: newId(),
      type,
      color: type === 'pen' ? toolState.penColor : toolState.hlColor,
      size: (type === 'pen' ? toolState.penSize : toolState.hlSize) / v.scale,
      ...(type === 'highlighter' ? { opacity: toolState.hlOpacity } : {}),
      pts: [loc.x, loc.y, realPressure ? e.pressure : 0.5],
      sim: !realPressure,
    };
    const live = v.createLiveLayer(page);
    let raf = 0;
    // points the browser predicts the pen will reach next frame; drawn but never saved
    let predicted: number[] = [];
    const draw = () => {
      raf = 0;
      live.reset();
      drawAnnotation(live.ctx, { ...ann, pts: predicted.length ? ann.pts.concat(predicted) : ann.pts.slice() });
    };
    const toPage = (ce: PointerEvent) => {
      const r = v.pageToClient(page, 0, 0);
      return [(ce.clientX - r.x) / v.scale, (ce.clientY - r.y) / v.scale];
    };
    draw();
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        for (const ce of this.events(ev)) {
          const [x, y] = toPage(ce);
          const n = ann.pts.length;
          if (Math.hypot(x - ann.pts[n - 3], y - ann.pts[n - 2]) * v.scale < 1.2) continue;
          ann.pts.push(x, y, realPressure ? ce.pressure || 0.5 : 0.5);
        }
        predicted = [];
        if (type === 'pen') {
          const pe = ((ev as any).getPredictedEvents?.() as PointerEvent[] | undefined) || [];
          for (const ce of pe.slice(0, 2)) {
            const [x, y] = toPage(ce);
            predicted.push(x, y, realPressure ? ce.pressure || 0.5 : 0.5);
          }
        }
        if (!raf) raf = requestAnimationFrame(draw);
      },
      up: () => {
        cancelAnimationFrame(raf);
        live.remove();
        const before = this.anns[page] || [];
        this.commit(page, before, [...before, ann]);
      },
      cancel: () => {
        cancelAnimationFrame(raf);
        live.remove();
      },
    };
  }

  private showRing(x: number, y: number, r = toolState.eraserSize) {
    const ring = this.eraserRing;
    const pr = ring.parentElement!.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.width = ring.style.height = r * 2 + 'px';
    ring.style.transform = `translate(${x - pr.left - r}px, ${y - pr.top - r}px)`;
  }

  private eraserAction(e: PointerEvent, radiusPx: number): Action {
    const v = this.viewer;
    const partial = toolState.eraserMode === 'partial';
    const befores = new Map<number, Annotation[]>();
    let last: { x: number; y: number } | null = null;
    const eraseAt = (cx: number, cy: number) => {
      const loc = v.locate(cx, cy, false);
      if (!loc) return;
      const list = this.anns[loc.page] || [];
      const r = radiusPx / v.scale;
      let changed = false;
      const keep: Annotation[] = [];
      for (const a of list) {
        if (partial && (a.type === 'pen' || a.type === 'highlighter')) {
          const pieces = eraseFromStroke(a, loc.x, loc.y, r);
          if (pieces) { changed = true; keep.push(...pieces); } else keep.push(a);
        } else if (hitTest(a, loc.x, loc.y, r)) changed = true;
        else keep.push(a);
      }
      if (changed) {
        if (!befores.has(loc.page)) befores.set(loc.page, list);
        this.anns[loc.page] = keep;
        v.drawAnnotations(loc.page);
      }
    };
    const visit = (cx: number, cy: number) => {
      if (last) {
        const d = Math.hypot(cx - last.x, cy - last.y);
        const steps = Math.ceil(d / Math.max(4, radiusPx / 2));
        for (let i = 1; i <= steps; i++) eraseAt(last.x + ((cx - last.x) * i) / steps, last.y + ((cy - last.y) * i) / steps);
      } else eraseAt(cx, cy);
      last = { x: cx, y: cy };
      this.showRing(cx, cy, radiusPx);
    };
    visit(e.clientX, e.clientY);
    const finish = () => {
      this.eraserRing.style.display = 'none';
      for (const [page, before] of befores) {
        this.history.push(page, before, this.anns[page]);
        this.cb.onChange(page);
      }
    };
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => { for (const ce of this.events(ev)) visit(ce.clientX, ce.clientY); },
      up: finish,
      cancel: () => {
        // restore anything erased
        for (const [page, before] of befores) { this.anns[page] = before; v.drawAnnotations(page); }
        this.eraserRing.style.display = 'none';
      },
    };
  }

  private shapeAction(e: PointerEvent): Action | null {
    const v = this.viewer;
    const loc = v.locate(e.clientX, e.clientY, true);
    if (!loc) return null;
    const page = loc.page;
    const ann: ShapeAnn = {
      id: newId(), type: 'shape', kind: toolState.shapeKind, color: toolState.shapeColor,
      size: toolState.shapeSize / v.scale, fill: toolState.shapeFill,
      x1: loc.x, y1: loc.y, x2: loc.x, y2: loc.y,
    };
    const live = v.createLiveLayer(page);
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        const r = v.pageToClient(page, 0, 0);
        ann.x2 = (ev.clientX - r.x) / v.scale;
        ann.y2 = (ev.clientY - r.y) / v.scale;
        // snap lines to horizontal / vertical / 45° when close
        if (ann.kind === 'line' || ann.kind === 'arrow') {
          const ang = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
          const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          if (Math.abs(ang - snap) < 0.06) {
            const len = Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1);
            ann.x2 = ann.x1 + len * Math.cos(snap);
            ann.y2 = ann.y1 + len * Math.sin(snap);
          }
        }
        live.reset();
        drawAnnotation(live.ctx, ann);
      },
      up: () => {
        live.remove();
        if (Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) * v.scale < 8) return;
        const before = this.anns[page] || [];
        this.commit(page, before, [...before, ann]);
      },
      cancel: () => live.remove(),
    };
  }

  private laserAction(e: PointerEvent): Action {
    const trail = { pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    this.laserTrails.push(trail);
    this.runLaser();
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        for (const ce of this.events(ev)) trail.pts.push({ x: ce.clientX, y: ce.clientY, t: performance.now() });
        this.runLaser();
      },
      up: () => {},
      cancel: () => {},
    };
  }

  private runLaser() {
    if (this.laserRaf) return;
    const c = this.laser;
    const tick = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, -r.left * dpr, -r.top * dpr);
      ctx.clearRect(r.left, r.top, r.width, r.height);
      const now = performance.now();
      const LIFE = 900;
      for (const tr of this.laserTrails) {
        const active = this.action && tr === this.laserTrails[this.laserTrails.length - 1];
        tr.pts = tr.pts.filter((p) => now - p.t < LIFE || (active && p === tr.pts[tr.pts.length - 1]));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < tr.pts.length; i++) {
          const a = tr.pts[i - 1], b = tr.pts[i];
          const life = 1 - (now - b.t) / LIFE;
          ctx.strokeStyle = `rgba(255,40,40,${Math.max(0, life) * 0.9})`;
          ctx.shadowColor = 'rgba(255,0,0,0.9)';
          ctx.shadowBlur = 14;
          ctx.lineWidth = 7 + 5 * life;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        const tip = tr.pts[tr.pts.length - 1];
        if (tip && active) {
          ctx.shadowBlur = 24; ctx.fillStyle = '#ff2a2a';
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      this.laserTrails = this.laserTrails.filter((t) => t.pts.length > 0);
      if (this.laserTrails.length) this.laserRaf = requestAnimationFrame(tick);
      else { this.laserRaf = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); }
    };
    this.laserRaf = requestAnimationFrame(tick);
  }

  /** text / note / stamp: act on a tap (finger lifted without dragging far) */
  private tapAction(e: PointerEvent, tool: 'text' | 'note' | 'stamp'): Action {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 24) moved = true; },
      up: (ev) => {
        if (moved) return;
        const v = this.viewer;
        const loc = v.locate(ev.clientX, ev.clientY, false);
        if (!loc) return;
        const list = this.anns[loc.page] || [];
        if (tool === 'stamp') {
          const ann: StampAnn = {
            id: newId(), type: 'stamp', x: loc.x, y: loc.y, glyph: toolState.stamp,
            size: toolState.stampSize / v.scale, color: toolState.stampColor,
          };
          this.commit(loc.page, list, [...list, ann]);
          return;
        }
        // tapping existing text/note re-opens it for editing
        const hit = [...list].reverse().find((a) => (a.type === 'text' || a.type === 'note') && hitTest(a, loc.x, loc.y, 6 / v.scale));
        if (hit && (hit.type === 'text' || hit.type === 'note')) { this.editText(loc.page, hit, false); return; }
        if (tool === 'text') {
          const fs = toolState.textSize / v.scale;
          const ann: TextAnn = { id: newId(), type: 'text', x: loc.x, y: loc.y - fs * 0.6, text: '', color: toolState.textColor, fontSize: fs };
          this.editText(loc.page, ann, true);
        } else {
          const w = 300 / v.scale;
          const ann: NoteAnn = {
            id: newId(), type: 'note', x: loc.x - w / 2, y: loc.y - w / 2, w, h: w, text: '',
            color: toolState.noteColor, fontSize: 30 / v.scale,
          };
          this.editText(loc.page, ann, true);
        }
      },
      cancel: () => {},
    };
  }

  // ---------------- text editing overlay ----------------

  editText(page: number, ann: TextAnn | NoteAnn, isNew: boolean) {
    this.finishEditing();
    this.clearSelection();
    const before = this.anns[page] || [];
    const ta = document.createElement('textarea');
    ta.className = 'text-editor ' + ann.type;
    ta.value = ann.text;
    ta.spellcheck = true;
    ta.setAttribute('enterkeyhint', 'enter');
    this.viewer.pagesView[page].el.appendChild(ta);
    this.editing = { page, ann, isNew, before, el: ta };
    if (!isNew) { this.viewer.hidden.add(ann.id); this.viewer.drawAnnotations(page); }
    ta.addEventListener('input', () => this.positionEditor());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.finishEditing(); }
      e.stopPropagation();
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (this.editing?.el === ta) this.finishEditing(); }, 150));
    this.positionEditor();
    ta.focus({ preventScroll: true });
  }

  private positionEditor() {
    const ed = this.editing;
    if (!ed) return;
    const s = this.viewer.scale;
    const a = ed.ann;
    const ta = ed.el;
    ta.style.left = a.x * s + 'px';
    ta.style.top = a.y * s + 'px';
    ta.style.fontSize = a.fontSize * s + 'px';
    if (a.type === 'note') {
      ta.style.width = a.w * s + 'px';
      ta.style.height = a.h * s + 'px';
      ta.style.padding = a.w * 0.07 * s + 'px';
      ta.style.background = a.color;
      ta.style.fontFamily = '"Comic Sans MS", "Comic Neue", "Segoe Print", "Chalkboard SE", ' + FONT_STACK;
    } else {
      ta.style.color = a.color;
      ta.style.fontFamily = FONT_STACK;
      ta.style.lineHeight = '1.25';
      ta.style.height = 'auto';
      ta.style.width = 'auto';
      const lines = ta.value.split('\n');
      const longest = Math.max(4, ...lines.map((l) => l.length));
      ta.style.width = `calc(${longest + 2}ch + 16px)`;
      ta.style.height = lines.length * a.fontSize * 1.25 * s + 16 + 'px';
    }
  }

  finishEditing() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const text = ed.el.value.replace(/\s+$/, '');
    ed.el.remove();
    this.viewer.hidden.delete(ed.ann.id);
    const page = ed.page;
    const before = ed.before;
    if (ed.isNew) {
      if (text) this.commit(page, before, [...before, { ...ed.ann, text }]);
    } else if (!text && ed.ann.type === 'text') {
      this.commit(page, before, before.filter((a) => a.id !== ed.ann.id));
    } else if (text !== ed.ann.text) {
      this.commit(page, before, before.map((a) => (a.id === ed.ann.id ? { ...ed.ann, text } : a)));
    } else this.viewer.drawAnnotations(page);
  }

  // ---------------- selection ----------------

  private selectAction(e: PointerEvent): Action | null {
    const v = this.viewer;
    const target = e.target as HTMLElement;
    if (target.closest('.sel-handle') && this.selection) return this.scaleSelAction(e);
    const loc = v.locate(e.clientX, e.clientY, true);
    if (!loc) return null;
    const page = loc.page;
    const now = performance.now();
    const dbl = now - this.lastTap.t < 400 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30;
    this.lastTap = { t: now, x: e.clientX, y: e.clientY };

    const list = this.anns[page] || [];
    const tol = 10 / v.scale;
    const sel = this.selection;
    const selRect = sel && sel.page === page ? v.selectionRect(page, sel.ids) : null;
    const inSel = selRect && loc.x >= selRect.x - tol && loc.x <= selRect.x + selRect.w + tol && loc.y >= selRect.y - tol && loc.y <= selRect.y + selRect.h + tol;
    if (!inSel) {
      const hit = [...list].reverse().find((a) => hitTest(a, loc.x, loc.y, tol));
      if (hit) {
        if (dbl && (hit.type === 'text' || hit.type === 'note')) { this.editText(page, hit, false); return null; }
        this.select(page, new Set([hit.id]));
      } else {
        this.clearSelection();
        return this.marqueeAction(e, page, loc.x, loc.y);
      }
    } else if (dbl && sel!.ids.size === 1) {
      const only = list.find((a) => sel!.ids.has(a.id));
      if (only && (only.type === 'text' || only.type === 'note')) { this.editText(page, only, false); return null; }
    }
    // drag to move the selection
    const ids = this.selection!.ids;
    const before = list;
    const originals = new Map(list.filter((a) => ids.has(a.id)).map((a) => [a.id, a]));
    let dx = 0, dy = 0;
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        const r = v.pageToClient(page, 0, 0);
        dx = (ev.clientX - r.x) / v.scale - loc.x;
        dy = (ev.clientY - r.y) / v.scale - loc.y;
        this.anns[page] = before.map((a) => (originals.has(a.id) ? translated(a, dx, dy) : a));
        v.drawAnnotations(page);
        this.positionSelection();
      },
      up: () => {
        if (Math.hypot(dx, dy) * v.scale < 2) { this.anns[page] = before; v.drawAnnotations(page); this.positionSelection(); return; }
        this.history.push(page, before, this.anns[page]);
        this.cb.onChange(page);
      },
      cancel: () => { this.anns[page] = before; v.drawAnnotations(page); this.positionSelection(); },
    };
  }

  private marqueeAction(e: PointerEvent, page: number, x0: number, y0: number): Action {
    const v = this.viewer;
    const live = v.createLiveLayer(page);
    let x1 = x0, y1 = y0;
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        const r = v.pageToClient(page, 0, 0);
        x1 = (ev.clientX - r.x) / v.scale;
        y1 = (ev.clientY - r.y) / v.scale;
        live.reset();
        const ctx = live.ctx;
        ctx.lineWidth = 2 / v.scale;
        ctx.setLineDash([8 / v.scale, 6 / v.scale]);
        ctx.strokeStyle = '#1a73e8';
        ctx.fillStyle = 'rgba(26,115,232,0.08)';
        ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      },
      up: () => {
        live.remove();
        const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        if (r.w * v.scale < 6 && r.h * v.scale < 6) return;
        const ids = new Set((this.anns[page] || []).filter((a) => rectsIntersect(bbox(a), r)).map((a) => a.id));
        if (ids.size) this.select(page, ids);
      },
      cancel: () => live.remove(),
    };
  }

  private scaleSelAction(e: PointerEvent): Action {
    const v = this.viewer;
    const { page, ids } = this.selection!;
    const rect = v.selectionRect(page, ids)!;
    const before = this.anns[page];
    const ox = rect.x, oy = rect.y;
    const d0 = Math.hypot(rect.w, rect.h) || 1;
    let s = 1;
    return {
      started: performance.now(),
      pointerId: e.pointerId,
      move: (ev) => {
        const r = v.pageToClient(page, 0, 0);
        const x = (ev.clientX - r.x) / v.scale, y = (ev.clientY - r.y) / v.scale;
        s = Math.max(0.1, Math.hypot(x - ox, y - oy) / d0);
        this.anns[page] = before.map((a) => (ids.has(a.id) ? scaled(a, s, ox, oy) : a));
        v.drawAnnotations(page);
        this.positionSelection();
      },
      up: () => {
        if (Math.abs(s - 1) < 0.01) return;
        this.history.push(page, before, this.anns[page]);
        this.cb.onChange(page);
      },
      cancel: () => { this.anns[page] = before; v.drawAnnotations(page); this.positionSelection(); },
    };
  }

  select(page: number, ids: Set<string>) {
    this.selection = { page, ids };
    if (!this.selBox) {
      const box = document.createElement('div');
      box.className = 'sel-box';
      box.innerHTML = `
        <div class="sel-bar">
          <button data-act="dup" title="Duplicate">⧉</button>
          <button data-act="del" title="Delete">🗑</button>
        </div>
        <div class="sel-handle" title="Drag to resize"></div>`;
      box.querySelector('[data-act=del]')!.addEventListener('click', () => this.deleteSelection());
      box.querySelector('[data-act=dup]')!.addEventListener('click', () => this.duplicateSelection());
      this.selBox = box;
    }
    this.viewer.pagesView[page].el.appendChild(this.selBox);
    this.positionSelection();
  }

  clearSelection() {
    this.selection = null;
    this.selBox?.remove();
  }

  private positionSelection() {
    const sel = this.selection, box = this.selBox;
    if (!sel || !box) return;
    const r = this.viewer.selectionRect(sel.page, sel.ids);
    if (!r) { this.clearSelection(); return; }
    const s = this.viewer.scale, pad = 8;
    box.style.left = r.x * s - pad + 'px';
    box.style.top = r.y * s - pad + 'px';
    box.style.width = r.w * s + pad * 2 + 'px';
    box.style.height = r.h * s + pad * 2 + 'px';
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    const before = this.anns[sel.page];
    this.clearSelection();
    this.commit(sel.page, before, before.filter((a) => !sel.ids.has(a.id)));
  }

  duplicateSelection() {
    const sel = this.selection;
    if (!sel) return;
    const before = this.anns[sel.page];
    const off = 24 / this.viewer.scale;
    const copies = before.filter((a) => sel.ids.has(a.id)).map((a) => ({ ...translated(a, off, off), id: newId() }));
    this.commit(sel.page, before, [...before, ...copies]);
    this.select(sel.page, new Set(copies.map((c) => c.id)));
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) { e.preventDefault(); this.deleteSelection(); }
    else if (e.key === 'Escape') this.clearSelection();
    else if (e.key === 'PageDown') { e.preventDefault(); this.viewer.goToPage(this.viewer.targetPage + 1); }
    else if (e.key === 'PageUp') { e.preventDefault(); this.viewer.goToPage(this.viewer.targetPage - 1); }
  }
}
