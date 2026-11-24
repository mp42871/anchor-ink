import { PDFDocument } from 'pdf-lib';
import { domToCanvas } from 'modern-screenshot';
import { canvasToBytes, type Progress } from './index';
import { withTimeout } from '../envinfo';

/**
 * Office documents are laid out in the browser (docx-preview / pptx-preview),
 * then each page is rasterised at high resolution into a PDF page. From then on
 * every document type is handled identically — a page-based PDF that the
 * annotations are anchored to.
 */

function makeHost(width?: number) {
  const host = document.createElement('div');
  host.className = 'raster-host';
  host.style.cssText =
    `position:absolute;left:-100000px;top:0;background:#fff;${width ? `width:${width}px;` : ''}` +
    'pointer-events:none;z-index:-1;';
  document.body.appendChild(host);
  return host;
}

async function settle(host: HTMLElement) {
  const wait = (async () => {
    await document.fonts?.ready;
    const imgs = Array.from(host.querySelectorAll('img'));
    await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => null))));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })();
  // fonts / images that never finish loading must not stall the conversion: carry on after 10 s
  await Promise.race([wait, new Promise((r) => setTimeout(r, 10_000))]);
}

async function rasterize(el: HTMLElement, scale: number) {
  const w = Math.ceil(el.offsetWidth);
  const h = Math.ceil(Math.max(el.offsetHeight, el.scrollHeight));
  // SVG foreignObject rendering: the browser lays the page out itself, so
  // text wrapping and fonts match what docx-preview produced exactly.
  const canvas = await domToCanvas(el, {
    scale,
    backgroundColor: '#ffffff',
    width: w,
    height: h,
    style: { margin: '0', boxShadow: 'none', position: 'static', left: '0', top: '0' },
  });
  return { canvas, w, h };
}

async function pagesToPdf(els: HTMLElement[], scale: number, progress: Progress, label: string) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < els.length; i++) {
    progress(`${label} ${i + 1} of ${els.length}…`);
    const { canvas, w, h } = await withTimeout(rasterize(els[i], scale), 45_000, `Converting ${label.toLowerCase()} ${i + 1}`);
    const img = await pdf.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.9));
    // CSS px → points (96dpi → 72dpi)
    const pw = w * 0.75, ph = h * 0.75;
    const page = pdf.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    canvas.width = canvas.height = 0;
  }
  return pdf.save();
}

export async function docxToPdf(blob: Blob, progress: Progress): Promise<Uint8Array> {
  const { renderAsync } = await import('docx-preview');
  const host = makeHost();
  try {
    await withTimeout(renderAsync(blob, host, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
      experimental: true,
    }), 60_000, 'Laying out the Word document');
    // the wrapper adds grey padding/shadows we don't want in the page images
    const style = document.createElement('style');
    style.textContent =
      '.raster-host .docx-wrapper{background:#fff!important;padding:0!important;display:block!important}' +
      '.raster-host .docx-wrapper>section.docx{box-shadow:none!important;margin:0 0 40px 0!important}';
    host.appendChild(style);
    await settle(host);
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.docx'));
    if (!sections.length) throw new Error('This Word document appears to be empty.');
    return await pagesToPdf(sections, 2, progress, 'Converting page');
  } finally {
    host.remove();
  }
}

export async function pptxToPdf(blob: Blob, progress: Progress): Promise<Uint8Array> {
  const { init } = await import('pptx-preview');
  const buf = await blob.arrayBuffer();
  // first pass to read the slide size so we keep the right aspect ratio
  const probeHost = makeHost(10);
  let ratio = 9 / 16;
  try {
    const probe = init(probeHost, { width: 10, height: 10, mode: 'list' });
    const pptx = await probe.load(buf.slice(0));
    if (pptx?.width && pptx?.height) ratio = pptx.height / pptx.width;
    probe.destroy?.();
  } catch {
    /* fall back to 16:9 */
  } finally {
    probeHost.remove();
  }
  const W = 1280, H = Math.round(W * ratio);
  const host = makeHost(W);
  try {
    const previewer = init(host, { width: W, height: H, mode: 'list' });
    await withTimeout(previewer.preview(buf), 60_000, 'Reading the slides');
    await settle(host);
    await new Promise((r) => setTimeout(r, 300)); // charts animate in
    let slides = Array.from(host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper'));
    if (!slides.length) slides = Array.from(host.querySelectorAll<HTMLElement>('[class*="slide-wrapper"]'));
    if (!slides.length) throw new Error('Could not find any slides in this presentation.');
    for (const s of slides) {
      s.style.margin = '0';
      s.style.boxShadow = 'none';
    }
    return await pagesToPdf(slides, 1.5, progress, 'Converting slide');
  } finally {
    host.remove();
  }
}

export async function textToPdf(text: string): Promise<Uint8Array> {
  const host = makeHost(816);
  try {
    const pages: HTMLElement[] = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const perPage = 48;
    for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
      const p = document.createElement('div');
      p.style.cssText =
        'width:816px;height:1056px;padding:72px;box-sizing:border-box;background:#fff;color:#111;' +
        'font:16px/1.25 Consolas,"Courier New",monospace;white-space:pre-wrap;overflow:hidden;';
      p.textContent = lines.slice(i, i + perPage).join('\n');
      host.appendChild(p);
      pages.push(p);
    }
    await settle(host);
    return await pagesToPdf(pages, 2, () => {}, 'Page');
  } finally {
    host.remove();
  }
}
