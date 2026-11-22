import { getStroke } from 'perfect-freehand';
import type { Annotation, Rect, StrokeAnn, ShapeAnn, TextAnn, NoteAnn, StampAnn } from './types';

let idCounter = 0;
export const newId = () =>
  Date.now().toString(36) + '-' + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

export const FONT_STACK = '"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Color Emoji", "Apple Color Emoji", sans-serif';
const HAND_FONT = '"Comic Sans MS", "Comic Neue", "Segoe Print", "Chalkboard SE", ' + FONT_STACK;

const pathCache = new WeakMap<StrokeAnn, Path2D>();

function strokeOutline(a: StrokeAnn): Path2D {
  let p = pathCache.get(a);
  if (p) return p;
  const input: number[][] = [];
  for (let i = 0; i < a.pts.length; i += 3) input.push([a.pts[i], a.pts[i + 1], a.pts[i + 2]]);
  const outline = getStroke(input, {
    size: a.size,
    thinning: a.sim ? 0.45 : 0.6,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !!a.sim,
    last: true,
  });
  p = new Path2D();
  if (outline.length) {
    p.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    p.closePath();
  }
  pathCache.set(a, p);
  return p;
}

function drawHighlighter(ctx: CanvasRenderingContext2D, a: StrokeAnn) {
  const pts = a.pts;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 3) ctx.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = 3; i < pts.length - 3; i += 3) {
    const mx = (pts[i] + pts[i + 3]) / 2, my = (pts[i + 1] + pts[i + 4]) / 2;
    ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
  }
  if (pts.length > 3) ctx.lineTo(pts[pts.length - 3], pts[pts.length - 2]);
  ctx.stroke();
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, a: ShapeAnn) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const { x1, y1, x2, y2 } = a;
  ctx.beginPath();
  if (a.kind === 'line' || a.kind === 'arrow') {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (a.kind === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(a.size * 4, 12);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang - 0.45), y2 - len * Math.sin(ang - 0.45));
      ctx.lineTo(x2 - len * Math.cos(ang + 0.45), y2 - len * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (a.kind === 'rect') ctx.rect(x, y, w, h);
    else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (a.fill) {
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function textLines(a: TextAnn): string[] {
  return (a.text || '').split('\n');
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

export function textBox(a: TextAnn): Rect {
  measureCtx.font = `${a.fontSize}px ${FONT_STACK}`;
  const lines = textLines(a);
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l || ' ').width);
  return { x: a.x, y: a.y, w: Math.max(w, a.fontSize * 0.6), h: lines.length * a.fontSize * 1.25 };
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnn) {
  ctx.save();
  ctx.fillStyle = a.color;
  ctx.font = `${a.fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';
  textLines(a).forEach((l, i) => ctx.fillText(l, a.x, a.y + i * a.fontSize * 1.25 + a.fontSize * 0.1));
  ctx.restore();
}

export function wrapLines(text: string, maxW: number, font: string): string[] {
  measureCtx.font = font;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (measureCtx.measureText(test).width > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawNote(ctx: CanvasRenderingContext2D, a: NoteAnn) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = a.w * 0.04;
  ctx.shadowOffsetY = a.w * 0.02;
  ctx.fillStyle = a.color;
  ctx.fillRect(a.x, a.y, a.w, a.h);
  ctx.shadowColor = 'transparent';
  // folded-tape strip
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(a.x + a.w * 0.35, a.y - a.h * 0.03, a.w * 0.3, a.h * 0.07);
  ctx.fillStyle = '#1f2328';
  const font = `${a.fontSize}px ${HAND_FONT}`;
  ctx.font = font;
  ctx.textBaseline = 'top';
  const pad = a.w * 0.07;
  const lines = wrapLines(a.text || '', a.w - pad * 2, font);
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();
  lines.forEach((l, i) => ctx.fillText(l, a.x + pad, a.y + pad + i * a.fontSize * 1.25));
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, a: StampAnn) {
  ctx.save();
  ctx.font = `bold ${a.size}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = a.color;
  ctx.fillText(a.glyph, a.x, a.y);
  ctx.restore();
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation) {
  switch (a.type) {
    case 'pen':
      ctx.fillStyle = a.color;
      ctx.fill(strokeOutline(a));
      break;
    case 'highlighter':
      drawHighlighter(ctx, a);
      break;
    case 'shape':
      drawShape(ctx, a);
      break;
    case 'text':
      drawText(ctx, a);
      break;
    case 'note':
      drawNote(ctx, a);
      break;
    case 'stamp':
      drawStamp(ctx, a);
      break;
  }
}

/** Draw all annotations for one page. ctx must already be scaled so 1 unit = 1 page point. */
export function drawAll(ctx: CanvasRenderingContext2D, anns: Annotation[], skip?: Set<string>) {
  // highlighters first so ink sits on top of them
  for (const a of anns) if (a.type === 'highlighter' && !skip?.has(a.id)) drawAnnotation(ctx, a);
  for (const a of anns) if (a.type !== 'highlighter' && !skip?.has(a.id)) drawAnnotation(ctx, a);
}

export function bbox(a: Annotation): Rect {
  switch (a.type) {
    case 'pen':
    case 'highlighter': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < a.pts.length; i += 3) {
        x0 = Math.min(x0, a.pts[i]); y0 = Math.min(y0, a.pts[i + 1]);
        x1 = Math.max(x1, a.pts[i]); y1 = Math.max(y1, a.pts[i + 1]);
      }
      const r = a.size / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
    }
    case 'shape': {
      const r = a.size / 2 + (a.kind === 'arrow' ? Math.max(a.size * 4, 12) : 0);
      const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2);
      return { x: x - r, y: y - r, w: Math.abs(a.x2 - a.x1) + 2 * r, h: Math.abs(a.y2 - a.y1) + 2 * r };
    }
    case 'text':
      return textBox(a);
    case 'note':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'stamp':
      return { x: a.x - a.size * 0.6, y: a.y - a.size * 0.6, w: a.size * 1.2, h: a.size * 1.2 };
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a circle at (x,y) with radius r touch annotation a? */
export function hitTest(a: Annotation, x: number, y: number, r: number): boolean {
  switch (a.type) {
    case 'pen':
    case 'highlighter': {
      const tol = r + a.size / 2;
      const p = a.pts;
      if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= tol;
      for (let i = 0; i < p.length - 3; i += 3)
        if (distToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= tol) return true;
      return false;
    }
    case 'shape': {
      const tol = r + a.size / 2;
      const { x1, y1, x2, y2 } = a;
      if (a.kind === 'line' || a.kind === 'arrow') return distToSeg(x, y, x1, y1, x2, y2) <= tol;
      const rx0 = Math.min(x1, x2), ry0 = Math.min(y1, y2), rx1 = Math.max(x1, x2), ry1 = Math.max(y1, y2);
      if (a.kind === 'rect') {
        if (a.fill && x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) return true;
        return (
          distToSeg(x, y, rx0, ry0, rx1, ry0) <= tol || distToSeg(x, y, rx1, ry0, rx1, ry1) <= tol ||
          distToSeg(x, y, rx1, ry1, rx0, ry1) <= tol || distToSeg(x, y, rx0, ry1, rx0, ry0) <= tol
        );
      }
      const cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2, ex = (rx1 - rx0) / 2 || 1, ey = (ry1 - ry0) / 2 || 1;
      const d = Math.hypot((x - cx) / ex, (y - cy) / ey);
      if (a.fill && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(ex, ey) <= tol;
    }
    default: {
      const b = bbox(a);
      return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r;
    }
  }
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Return a moved copy of the annotation. */
export function translated<T extends Annotation>(a: T, dx: number, dy: number): T {
  const c: any = { ...a };
  if (a.type === 'pen' || a.type === 'highlighter') {
    c.pts = a.pts.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v));
  } else if (a.type === 'shape') {
    c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy;
  } else {
    c.x += dx; c.y += dy;
  }
  return c;
}

/** Return a copy scaled about (ox, oy). */
export function scaled<T extends Annotation>(a: T, s: number, ox: number, oy: number): T {
  const c: any = { ...a };
  const fx = (v: number) => ox + (v - ox) * s, fy = (v: number) => oy + (v - oy) * s;
  if (a.type === 'pen' || a.type === 'highlighter') {
    c.pts = a.pts.map((v, i) => (i % 3 === 0 ? fx(v) : i % 3 === 1 ? fy(v) : v));
    c.size = a.size * s;
  } else if (a.type === 'shape') {
    c.x1 = fx(a.x1); c.x2 = fx(a.x2); c.y1 = fy(a.y1); c.y2 = fy(a.y2); c.size = a.size * s;
  } else if (a.type === 'text') {
    c.x = fx(a.x); c.y = fy(a.y); c.fontSize = a.fontSize * s;
  } else if (a.type === 'note') {
    c.x = fx(a.x); c.y = fy(a.y); c.w = a.w * s; c.h = a.h * s; c.fontSize = a.fontSize * s;
  } else if (a.type === 'stamp') {
    c.x = fx(a.x); c.y = fy(a.y); c.size = a.size * s;
  }
  return c;
}
