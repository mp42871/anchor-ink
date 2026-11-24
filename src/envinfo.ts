/** Human-readable description of the display's browser, for error messages and Help. */
export function browserInfo(): string {
  const ua = navigator.userAgent;
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  const edge = ua.match(/Edg\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = !chrome && ua.match(/Version\/(\d+).*Safari/);
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  const webview = /; wv\)/.test(ua) || /Version\/\d+.*Chrome/.test(ua);
  let name = 'Unknown browser';
  if (edge) name = `Edge ${edge[1]}`;
  else if (chrome) name = `${webview ? 'Android WebView' : 'Chrome'} ${chrome[1]}`;
  else if (firefox) name = `Firefox ${firefox[1]}`;
  else if (safari) name = `Safari ${safari[1]}`;
  const os = android ? `Android ${android[1]}` : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${name} on ${os}` : name;
}

/** Reject if a step takes longer than `ms`, so the app never spins forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error(`${what} took too long on this display (${browserInfo()}). Try again, or save the file as a PDF and open that instead.`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
