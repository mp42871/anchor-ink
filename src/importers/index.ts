import { PDFDocument, rgb } from 'pdf-lib';
import type { Annotation, TemplateOpts } from '../types';
import { extractProject } from './project';

export interface ImportResult {
  title: string;
  source: string;
  pdf: Uint8Array;
  pages?: Annotation[][];
  template?: TemplateOpts;
}

export type Progress = (msg: string) => void;

const ext = (name: string) => (name.split('.').pop() || '').toLowerCase();
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export const ACCEPT =
  '.pdf,.docx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.txt,' +
  'application/pdf,image/*,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function kindOf(name: string, mime = ''): 'pdf' | 'docx' | 'pptx' | 'image' | 'text' | 'legacy' | 'unknown' {
  const e = ext(name);
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (e === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (e === 'pptx' || mime.includes('presentationml')) return 'pptx';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(e) || mime.startsWith('image/')) return 'image';
  if (e === 'txt' || mime === 'text/plain') return 'text';
  if (['doc', 'ppt', 'xls', 'xlsx', 'odt', 'odp', 'rtf', 'pages', 'key'].includes(e)) return 'legacy';
  return 'unknown';
}

/** Import one or more files. Several images are combined into one multi-page document. */
export async function importFiles(files: File[], progress: Progress): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  const images = files.filter((f) => kindOf(f.name, f.type) === 'image');
  const others = files.filter((f) => kindOf(f.name, f.type) !== 'image');
  if (images.length) {
    progress(`Preparing ${images.length > 1 ? images.length + ' images' : 'image'}…`);
    out.push({
      title: images.length > 1 ? 'Images' : stripExt(images[0].name),
      source: 'image',
      pdf: await imagesToPdf(images),
    });
  }
  for (const f of others) out.push(await importBlob(f, f.name, f.type, progress));
  return out;
}

export async function importBlob(blob: Blob, name: string, mime: string, progress: Progress): Promise<ImportResult> {
  const kind = kindOf(name, mime);
  const title = stripExt(name);
  const bytes = () => blob.arrayBuffer().then((b) => new Uint8Array(b));
  switch (kind) {
    case 'pdf': {
      progress('Opening PDF…');
      const data = await bytes();
      const proj = await extractProject(data);
      if (proj)
        return { title: proj.project.title || title, source: proj.project.source || 'pdf', pdf: proj.pdf, pages: proj.project.pages };
      // validate it opens & normalise (repair minor corruption)
      return { title, source: 'pdf', pdf: data };
    }
    case 'docx': {
      progress('Laying out Word document…');
      const { docxToPdf } = await import('./office');
      return { title, source: 'docx', pdf: await docxToPdf(blob, progress) };
    }
    case 'pptx': {
      progress('Rendering slides…');
      const { pptxToPdf } = await import('./office');
      return { title, source: 'pptx', pdf: await pptxToPdf(blob, progress) };
    }
    case 'image':
      return { title, source: 'image', pdf: await imagesToPdf([blob]) };
    case 'text': {
      const { textToPdf } = await import('./office');
      return { title, source: 'text', pdf: await textToPdf(await blob.text()) };
    }
    case 'legacy':
      throw new Error(
        `“${name}” is an older or unsupported format. Please save it as PDF, .docx or .pptx (File → Save As / Download) and open that instead.`,
      );
    default:
      throw new Error(`Sorry, “${name}” isn't a supported file type.`);
  }
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function canvasToBytes(c: HTMLCanvasElement, type = 'image/png', q = 0.92): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('encode failed'))), type, q),
  );
}

/** Each image becomes a page; long side is ~1000pt so pen sizes feel natural. */
export async function imagesToPdf(blobs: Blob[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const b of blobs) {
    const img = await blobToImage(b);
    const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
    const maxPx = 4096;
    const k = Math.min(1, maxPx / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d')!;
    const isJpeg = /jpe?g/i.test(b.type);
    if (isJpeg) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const embedded = isJpeg
      ? await pdf.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.92))
      : await pdf.embedPng(await canvasToBytes(c));
    const s = 1000 / Math.max(w, h);
    const pw = w * s, ph = h * s;
    const page = pdf.addPage([pw, ph]);
    page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(1, 1, 1) });
    page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
  }
  return pdf.save();
}

export type Template = TemplateOpts['kind'];

export const MM = 72 / 25.4; // points per millimetre

export function defaultTemplate(kind: Template): TemplateOpts {
  switch (kind) {
    case 'lined': return { kind, spacing: 8.7 * MM, style: 'ruled', orientation: 'portrait' };
    case 'graph': return { kind, spacing: 6.35 * MM, orientation: 'portrait' };
    case 'dots': return { kind, spacing: 8.5 * MM, orientation: 'portrait' };
    default: return { kind: 'whiteboard', spacing: 0, orientation: 'landscape' };
  }
}

export function templateSize(o: TemplateOpts): [number, number] {
  if (o.kind === 'whiteboard') return [1600, 900];
  return o.orientation === 'landscape' ? [792, 612] : [612, 792];
}

export async function templatePdf(o: TemplateOpts, pageCount = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let n = 0; n < pageCount; n++) await addTemplatePage(pdf, o);
  return pdf.save();
}

const BLUE = rgb(0.6, 0.75, 0.92);
const RED = rgb(0.93, 0.45, 0.45);
const GRID = rgb(0.62, 0.78, 0.9);
const DOT = rgb(0.55, 0.6, 0.68);

export async function addTemplatePage(pdf: PDFDocument, o: TemplateOpts, index?: number, size?: [number, number]) {
  const [W, H] = size || templateSize(o);
  const page = index === undefined ? pdf.addPage([W, H]) : pdf.insertPage(index, [W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const s = Math.max(2 * MM, o.spacing || 0);
  if (o.kind === 'lined') {
    const top = H - Math.min(72, H * 0.09);
    const bottom = Math.min(36, H * 0.045);
    if (o.style === 'primary') {
      // handwriting lines: solid top line, dashed midline, solid baseline, then a gap
      const gap = s * 0.55;
      for (let y = top; y - s > bottom; y -= s + gap) {
        page.drawLine({ start: { x: 0, y }, end: { x: W, y }, thickness: 0.9, color: BLUE });
        page.drawLine({ start: { x: 0, y: y - s / 2 }, end: { x: W, y: y - s / 2 }, thickness: 0.7, color: BLUE, dashArray: [6, 5] });
        page.drawLine({ start: { x: 0, y: y - s }, end: { x: W, y: y - s }, thickness: 1.1, color: RED });
      }
    } else {
      for (let y = top; y > bottom; y -= s) page.drawLine({ start: { x: 0, y }, end: { x: W, y }, thickness: 0.6, color: BLUE });
      page.drawLine({ start: { x: 72, y: 0 }, end: { x: 72, y: H }, thickness: 0.8, color: RED });
    }
  } else if (o.kind === 'graph') {
    // bold every 5th line when the squares are small enough for it to help
    const major = s < 9 * MM ? 5 : 0;
    const n = Math.floor(W / s), m = Math.floor(H / s);
    const ox = (W - n * s) / 2, oy = (H - m * s) / 2;
    for (let i = 0; i <= n; i++) {
      const x = ox + i * s;
      page.drawLine({ start: { x, y: oy }, end: { x, y: H - oy }, thickness: major && i % major === 0 ? 0.8 : 0.35, color: GRID });
    }
    for (let j = 0; j <= m; j++) {
      const y = H - oy - j * s;
      page.drawLine({ start: { x: ox, y }, end: { x: W - ox, y }, thickness: major && j % major === 0 ? 0.8 : 0.35, color: GRID });
    }
  } else if (o.kind === 'dots') {
    const n = Math.floor(W / s), m = Math.floor(H / s);
    const ox = (W - n * s) / 2, oy = (H - m * s) / 2;
    const r = Math.max(0.7, Math.min(1.6, s / 18));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= m; j++) page.drawCircle({ x: ox + i * s, y: oy + j * s, size: r, color: DOT });
  }
  return page;
}
