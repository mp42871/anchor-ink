import type { Annotation } from '../types';
import { loadPdf, closePdf } from '../pdfjs';

/** File names used to embed the editable project inside exported PDFs. */
export const BASE_NAME = 'anchor-ink-original.pdf';
export const ANN_NAME = 'anchor-ink-annotations.json';

export interface ProjectPayload {
  app: 'anchor-ink';
  version: 1;
  title: string;
  source: string;
  pages: Annotation[][];
}

/**
 * If this PDF was saved by Anchor Ink, return the clean original document plus
 * the editable annotations, so the teacher can keep editing where they left off.
 */
export async function extractProject(bytes: Uint8Array): Promise<{ pdf: Uint8Array; project: ProjectPayload } | null> {
  let doc;
  try {
    doc = await loadPdf(bytes);
  } catch {
    return null;
  }
  try {
    const atts = await doc.getAttachments();
    if (!atts) return null;
    let base: Uint8Array | null = null;
    let json: Uint8Array | null = null;
    for (const [id, a] of atts) {
      const name = a.filename || a.rawFilename;
      if (name !== BASE_NAME && name !== ANN_NAME) continue;
      let content = a.content ?? null;
      if (!content && typeof (doc as any).getAttachmentContent === 'function')
        content = await (doc as any).getAttachmentContent(id);
      if (name === BASE_NAME) base = content;
      else json = content;
    }
    if (!base || !json) return null;
    const project = JSON.parse(new TextDecoder().decode(json)) as ProjectPayload;
    if (project.app !== 'anchor-ink') return null;
    return { pdf: new Uint8Array(base), project };
  } catch (e) {
    console.warn('Could not read embedded project', e);
    return null;
  } finally {
    closePdf(doc);
  }
}
