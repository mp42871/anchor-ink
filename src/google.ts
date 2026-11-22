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
const ACCOUNT_KEY = 'anchor-ink-google-account';
let token: { value: string; expires: number } | null = null;

export const googleConfigured = () => !!(settings.googleClientId && settings.googleApiKey);

export interface DriveAccount { email: string; name: string }

export function driveAccount(): DriveAccount | null {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null'); } catch { return null; }
}
function setAccount(a: DriveAccount | null) {
  try { a ? localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)) : localStorage.removeItem(ACCOUNT_KEY); } catch {}
}

/** Load Google's scripts early so the sign-in popup opens instantly on tap (popup blockers need that). */
export function preloadGoogle() {
  if (!googleConfigured()) return;
  loadScript('https://accounts.google.com/gsi/client').catch(() => {});
  loadScript('https://apis.google.com/js/api.js')
    .then(() => gapi.load('picker', () => {}))
    .catch(() => {});
}

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

async function getToken(interactive = false): Promise<string> {
  if (token && Date.now() < token.expires - 60_000) return token.value;
  await loadScript('https://accounts.google.com/gsi/client');
  const acct = driveAccount();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: settings.googleClientId,
      scope: SCOPE,
      // remembered teacher: Google re-issues the token without asking again
      ...(acct?.email ? { login_hint: acct.email } : {}),
      callback: (r: any) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = { value: r.access_token, expires: Date.now() + Number(r.expires_in || 3600) * 1000 };
        res(token.value);
      },
      error_callback: (e: any) =>
        rej(new Error(e?.type === 'popup_failed_to_open'
          ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
          : 'Google sign-in was cancelled.')),
    });
    client.requestAccessToken({ prompt: interactive || !acct ? 'select_account' : '' });
  });
}

/** Sign in and remember the teacher's Google account on this board. */
export async function connectDrive(): Promise<DriveAccount> {
  token = null;
  const t = await getToken(true);
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
    headers: { Authorization: `Bearer ${t}` },
  });
  const j = r.ok ? await r.json() : {};
  const acct = { email: j.user?.emailAddress || '', name: j.user?.displayName || 'Google Drive' };
  setAccount(acct);
  return acct;
}

export function disconnectDrive() {
  const t = token?.value;
  token = null;
  setAccount(null);
  try { if (t) google.accounts.oauth2.revoke(t, () => {}); } catch {}
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

export async function pickFromDrive(): Promise<PickedFile[]> {
  const t = await getToken();
  if (!driveAccount()) await connectDriveWithToken(t);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((r) => gapi.load('picker', () => r()));
  return new Promise((res) => {
    const P = google.picker;
    const mimes = [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.drawing',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    ].join(',');
    const myDrive = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setIncludeFolders(true).setSelectFolderEnabled(false);
    const starred = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setStarred(true);
    const drives = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(false);
    // big, touch-friendly picker that also fits a split-screen window
    const w = Math.max(320, Math.min(1400, window.innerWidth - 40));
    const hgt = Math.max(320, Math.min(1000, window.innerHeight - 40));
    const builder = new P.PickerBuilder()
      .addView(myDrive)
      .addView(new P.View(P.ViewId.RECENTLY_PICKED))
      .addView(starred)
      .addView(drives)
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setOAuthToken(t)
      .setDeveloperKey(settings.googleApiKey)
      .setOrigin(window.location.protocol + '//' + window.location.host)
      .setSize(w, hgt)
      .setTitle('Choose documents to open')
      .setCallback((data: any) => {
        if (data.action === P.Action.PICKED)
          res((data.docs || []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType })));
        else if (data.action === P.Action.CANCEL) res([]);
      });
    if (settings.googleAppId) builder.setAppId(settings.googleAppId);
    builder.build().setVisible(true);
  });
}

async function connectDriveWithToken(t: string) {
  try {
    const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json();
    setAccount({ email: j.user?.emailAddress || '', name: j.user?.displayName || 'Google Drive' });
  } catch {}
}

/** Download a Drive file; Google-native files are exported as PDF. */
export async function downloadDriveFile(f: PickedFile): Promise<{ blob: Blob; name: string; mime: string }> {
  const t = await getToken();
  const isGoogle = f.mimeType.startsWith('application/vnd.google-apps.');
  const url = isGoogle
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=application/pdf&supportsAllDrives=true`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (r.status === 401) { token = null; throw new Error('Your Google sign-in expired. Please try again.'); }
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

// ------------------------------------------------------------------ setup link
/**
 * IT sets up Google once, then shares a link like  https://site/#setup=…  .
 * Opening it on any board stores the (public, non-secret) client ID / API key,
 * so teachers only ever press "Connect Google Drive".
 */
export function setupLink(): string {
  const cfg = { c: settings.googleClientId, k: settings.googleApiKey, a: settings.googleAppId };
  const enc = btoa(JSON.stringify(cfg)).replace(/=+$/, '');
  return `${location.origin}${location.pathname}#setup=${enc}`;
}

export function applySetupFromUrl(): boolean {
  const m = location.hash.match(/setup=([A-Za-z0-9+/_-]+)/);
  if (!m) return false;
  try {
    const cfg = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (cfg.c) settings.googleClientId = String(cfg.c);
    if (cfg.k) settings.googleApiKey = String(cfg.k);
    if (cfg.a) settings.googleAppId = String(cfg.a);
    history.replaceState(null, '', location.pathname + location.search);
    return !!(cfg.c && cfg.k);
  } catch {
    return false;
  }
}
