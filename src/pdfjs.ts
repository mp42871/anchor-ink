import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

/** pdf.js transfers (detaches) the buffer it is given, so always hand it a copy. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

export function closePdf(doc: PDFDocumentProxy | null | undefined) {
  if (doc) tasks.get(doc)?.destroy().catch(() => {});
}
