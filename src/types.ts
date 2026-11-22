/**
 * All annotation geometry is stored in PAGE UNITS (PDF points of the page as
 * displayed, i.e. pdf.js viewport at scale 1, rotation applied). Because the
 * coordinates belong to the page — not the screen — annotations stay glued to
 * the exact spot on the document no matter how it is scrolled or zoomed.
 */
export type ToolId =
  | 'hand' | 'select' | 'pen' | 'highlighter' | 'eraser'
  | 'shape' | 'text' | 'note' | 'stamp' | 'laser';

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse';

interface AnnBase { id: string }

export interface StrokeAnn extends AnnBase {
  type: 'pen' | 'highlighter';
  color: string;
  size: number;
  /** flat list: x, y, pressure, x, y, pressure ... */
  pts: number[];
  /** true when pressure was simulated (finger/mouse) */
  sim?: boolean;
  /** highlighter transparency (0–1); default 0.38 */
  opacity?: number;
}

export interface ShapeAnn extends AnnBase {
  type: 'shape';
  kind: ShapeKind;
  color: string;
  size: number;
  fill?: boolean;
  x1: number; y1: number; x2: number; y2: number;
}

export interface TextAnn extends AnnBase {
  type: 'text';
  x: number; y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface NoteAnn extends AnnBase {
  type: 'note';
  x: number; y: number; w: number; h: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface StampAnn extends AnnBase {
  type: 'stamp';
  x: number; y: number;
  glyph: string;
  size: number;
  color: string;
}

export type Annotation = StrokeAnn | ShapeAnn | TextAnn | NoteAnn | StampAnn;

export interface TemplateOpts {
  kind: 'whiteboard' | 'lined' | 'graph' | 'dots';
  /** line / grid / dot spacing in PDF points */
  spacing: number;
  /** lined paper: 'ruled' = single lines, 'primary' = handwriting lines with dashed midline */
  style?: 'ruled' | 'primary';
  orientation: 'portrait' | 'landscape';
}

export interface DocMeta {
  id: string;
  title: string;
  source: string;
  created: number;
  updated: number;
  pageCount: number;
  thumb?: string;
  /** set for blank paper documents so added pages match */
  template?: TemplateOpts;
}

export interface OpenedDoc {
  meta: DocMeta;
  pdf: Uint8Array;
  pages: Annotation[][];
}

export interface Rect { x: number; y: number; w: number; h: number }
