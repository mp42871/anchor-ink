// The legacy build bundles polyfills (core-js), including inside the worker,
// so PDFs open on displays whose built-in browser is a few years old.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { withTimeout } from './envinfo';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

/** pdf.js transfers (detaches) the buffer it is given, so always hand it a copy. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc: PDFDocumentProxy;
  try {
    // if the PDF engine can't start on this browser, fail with a clear message instead of hanging
    doc = await withTimeout(task.promise, 60_000, 'Opening the document');
  } catch (e) {
    task.destroy().catch(() => {});
    throw e;
  }
  tasks.set(doc, task);
  return doc;
}

export function closePdf(doc: PDFDocumentProxy | null | undefined) {
  if (doc) tasks.get(doc)?.destroy().catch(() => {});
}
