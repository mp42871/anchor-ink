import type { Annotation, DocMeta, OpenedDoc } from './types';

/** Tiny IndexedDB wrapper — everything stays on the device, works offline. */
const DB_NAME = 'anchor-ink';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('meta', { keyPath: 'id' });
        d.createObjectStore('pdf');
        d.createObjectStore('ann');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => void) {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction(stores, mode);
    fn(t);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export async function listDocs(): Promise<DocMeta[]> {
  const d = await db();
  const all = await req(d.transaction('meta').objectStore('meta').getAll() as IDBRequest<DocMeta[]>);
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveDoc(doc: OpenedDoc) {
  await tx(['meta', 'pdf', 'ann'], 'readwrite', (t) => {
    t.objectStore('meta').put(doc.meta);
    t.objectStore('pdf').put(doc.pdf, doc.meta.id);
    t.objectStore('ann').put(doc.pages, doc.meta.id);
  });
}

export async function saveAnnotations(meta: DocMeta, pages: Annotation[][]) {
  await tx(['meta', 'ann'], 'readwrite', (t) => {
    t.objectStore('meta').put(meta);
    t.objectStore('ann').put(pages, meta.id);
  });
}

export async function saveMeta(meta: DocMeta) {
  await tx(['meta'], 'readwrite', (t) => t.objectStore('meta').put(meta));
}

export async function loadDoc(id: string): Promise<OpenedDoc | null> {
  const d = await db();
  const t = d.transaction(['meta', 'pdf', 'ann']);
  const [meta, pdf, pages] = await Promise.all([
    req(t.objectStore('meta').get(id) as IDBRequest<DocMeta>),
    req(t.objectStore('pdf').get(id) as IDBRequest<Uint8Array>),
    req(t.objectStore('ann').get(id) as IDBRequest<Annotation[][]>),
  ]);
  if (!meta || !pdf) return null;
  return { meta, pdf, pages: pages || [] };
}

export async function deleteDoc(id: string) {
  await tx(['meta', 'pdf', 'ann'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('pdf').delete(id);
    t.objectStore('ann').delete(id);
  });
}

/** Ask the browser not to evict our data when storage is tight. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
