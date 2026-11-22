import { PDFDocument, degrees } from 'pdf-lib';
import type { Annotation, OpenedDoc } from './types';
import { drawAll } from './annotations';
import { ANN_NAME, BASE_NAME, type ProjectPayload } from './importers/project';
import { canvasToBytes } from './importers/index';
import { loadPdf, closePdf } from './pdfjs';

/** Render one page's annotation layer to a transparent canvas, in page orientation. */
export function renderAnnotationLayer(anns: Annotation[], w: number, h: number, scale: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.scale(c.width / w, c.height / h);
  drawAll(ctx, anns);
  return c;
}

/**
 * Build a PDF that anyone can open (annotations flattened on top of each page)
 * and that ALSO carries the original document + editable annotations as
 * attachments, so re-opening it in Anchor Ink restores everything editable.
 */
export async function buildAnnotatedPdf(doc: OpenedDoc, onProgress?: (m: string) => void): Promise<Uint8Array> {
  const out = await PDFDocument.load(doc.pdf, { ignoreEncryption: true, updateMetadata: false });
  const pages = out.getPages();
  for (let i = 0; i < pages.length; i++) {
    const anns = doc.pages[i];
    if (!anns?.length) continue;
    onProgress?.(`Saving page ${i + 1} of ${pages.length}…`);
    const page = pages[i];
    const cb = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const W = rot % 180 ? cb.height : cb.width; // displayed size
    const H = rot % 180 ? cb.width : cb.height;
    const scale = Math.min(4, 3000 / Math.max(W, H));
    const layer = renderAnnotationLayer(anns, W, H, scale);
    const img = await out.embedPng(await canvasToBytes(layer));
    layer.width = layer.height = 0;
    // Undo the page's /Rotate so the overlay lines up with what the viewer shows.
    let x = cb.x, y = cb.y;
    if (rot === 90) x = cb.x + cb.width;
    else if (rot === 180) { x = cb.x + cb.width; y = cb.y + cb.height; }
    else if (rot === 270) y = cb.y + cb.height;
    page.drawImage(img, { x, y, width: W, height: H, rotate: degrees(rot) });
  }
  const payload: ProjectPayload = {
    app: 'anchor-ink',
    version: 1,
    title: doc.meta.title,
    source: doc.meta.source,
    pages: doc.pages,
  };
  await out.attach(doc.pdf, BASE_NAME, {
    mimeType: 'application/pdf',
    description: 'Original document (used by Anchor Ink to keep annotations editable)',
  });
  await out.attach(new TextEncoder().encode(JSON.stringify(payload)), ANN_NAME, {
    mimeType: 'application/json',
    description: 'Anchor Ink editable annotations',
  });
  out.setTitle(doc.meta.title);
  out.setCreator('Anchor Ink');
  out.setModificationDate(new Date());
  return out.save();
}

export function safeFileName(title: string) {
  return (title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
}

export function downloadBytes(bytes: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareFile(bytes: Uint8Array | Blob, name: string, title: string, type = 'application/pdf') {
  const file = new File([bytes as BlobPart], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: title });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  return 'unsupported';
}

/** Page image (document + ink) as PNG. */
export async function renderPagePng(doc: OpenedDoc, index: number, longSide = 2400): Promise<Blob> {
  const pdf = await loadPdf(doc.pdf);
  try {
    const page = await pdf.getPage(index + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = longSide / Math.max(vp1.width, vp1.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    ctx.save();
    ctx.scale(c.width / vp1.width, c.height / vp1.height);
    drawAll(ctx, doc.pages[index] || []);
    ctx.restore();
    return await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode'))), 'image/png'));
  } finally {
    closePdf(pdf);
  }
}

/** Small JPEG data-URL thumbnail of page 1 for the home screen. */
export async function makeThumb(doc: OpenedDoc): Promise<string | undefined> {
  try {
    const pdf = await loadPdf(doc.pdf);
    try {
      const page = await pdf.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = 360 / Math.max(vp1.width, vp1.height);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      ctx.scale(scale, scale);
      drawAll(ctx, doc.pages[0] || []);
      return c.toDataURL('image/jpeg', 0.75);
    } finally {
      closePdf(pdf);
    }
  } catch {
    return undefined;
  }
}
