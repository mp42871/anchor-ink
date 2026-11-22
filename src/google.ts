import { settings } from './settings';

/**
 * Google Drive integration (optional). Uses Google Identity Services for an
 * OAuth token with the narrow `drive.file` scope and the Google Picker so the
 * teacher can pick Docs / Slides / Sheets / PDFs / Word files. Google files are
 * exported by Drive as PDF, which keeps their exact page layout.
 */

declare const google: any;
declare const gapi: any;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let token: { value: string; expires: number } | null = null;

export const googleConfigured = () => !!(settings.googleClientId && settings.googleApiKey);

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => { loaded.delete(src); rej(new Error('Could not reach Google. Check the internet connection.')); };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expires - 60_000) return token.value;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: settings.googleClientId,
      scope: SCOPE,
      callback: (r: any) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = { value: r.access_token, expires: Date.now() + Number(r.expires_in || 3600) * 1000 };
        res(token.value);
      },
      error_callback: (e: any) => rej(new Error(e?.message || 'Google sign-in was cancelled.')),
    });
    client.requestAccessToken({ prompt: token ? '' : 'select_account' });
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

export async function pickFromDrive(): Promise<PickedFile | null> {
  const t = await getToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((r) => gapi.load('picker', () => r()));
  return new Promise((res) => {
    const P = google.picker;
    const docs = new P.DocsView(P.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes(
        [
          'application/vnd.google-apps.document',
          'application/vnd.google-apps.presentation',
          'application/vnd.google-apps.spreadsheet',
          'application/vnd.google-apps.drawing',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'image/png', 'image/jpeg', 'image/gif', 'image/webp',
        ].join(','),
      );
    const builder = new P.PickerBuilder()
      .addView(docs)
      .addView(new P.DocsView(P.ViewId.PRESENTATIONS))
      .addView(new P.DocsView(P.ViewId.DOCUMENTS))
      .setOAuthToken(t)
      .setDeveloperKey(settings.googleApiKey)
      .setTitle('Open from Google Drive')
      .setCallback((data: any) => {
        if (data.action === P.Action.PICKED) {
          const d = data.docs[0];
          res({ id: d.id, name: d.name, mimeType: d.mimeType });
        } else if (data.action === P.Action.CANCEL) res(null);
      });
    if (settings.googleAppId) builder.setAppId(settings.googleAppId);
    builder.build().setVisible(true);
  });
}

/** Download a Drive file; Google-native files are exported as PDF. */
export async function downloadDriveFile(f: PickedFile): Promise<{ blob: Blob; name: string; mime: string }> {
  const t = await getToken();
  const isGoogle = f.mimeType.startsWith('application/vnd.google-apps.');
  const url = isGoogle
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) {
    const msg = r.status === 403 && isGoogle
      ? 'Google could not export this file (it may be larger than 10 MB). Try File → Download → PDF in Google, then open that file.'
      : `Google Drive returned an error (${r.status}).`;
    throw new Error(msg);
  }
  const blob = await r.blob();
  return {
    blob,
    name: isGoogle ? `${f.name}.pdf` : f.name,
    mime: isGoogle ? 'application/pdf' : f.mimeType,
  };
}

/** Upload (or overwrite) a PDF in Drive. Returns the file id and a shareable view link. */
export async function uploadToDrive(bytes: Uint8Array, name: string, existingId?: string): Promise<{ id: string; webViewLink: string }> {
  const t = await getToken();
  const boundary = 'anchorink' + Math.random().toString(36).slice(2);
  const meta = existingId ? { name } : { name, mimeType: 'application/pdf' };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    bytes as BlobPart,
    `\r\n--${boundary}--`,
  ]);
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
  const r = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) {
    if (existingId && r.status === 404) return uploadToDrive(bytes, name);
    throw new Error(`Saving to Google Drive failed (${r.status}).`);
  }
  return r.json();
}
