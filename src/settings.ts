import type { ShapeKind, ToolId } from './types';

export interface Settings {
  dockSide: 'left' | 'right';
  /** free-floating toolbar position as fractions of the free space (null = docked to dockSide) */
  dockPos: { x: number; y: number } | null;
  dockMin: boolean;
  /**
   * 'auto': everything draws until the board shows it can tell the pen from a
   *         finger (it reports a stylus, or Pen setup found a size difference);
   *         from then on the pen writes and fingers scroll.
   * 'all':  finger and pen both draw (two fingers scroll).
   * 'pen':  only the pen draws, fingers always scroll.
   */
  drawWith: 'auto' | 'all' | 'pen';
  /** contact sizes (CSS px) measured in Pen setup; 0 = not calibrated */
  penMaxSize: number;
  fingerSize: number;
  palmErase: boolean;
  googleClientId: string;
  googleApiKey: string;
  googleAppId: string;
}

const KEY = 'anchor-ink-settings';

const defaults: Settings = {
  dockSide: 'left',
  dockPos: null,
  dockMin: false,
  drawWith: 'auto',
  penMaxSize: 0,
  fingerSize: 0,
  palmErase: false,
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  googleApiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
  googleAppId: import.meta.env.VITE_GOOGLE_APP_ID || '',
};

function load(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    const merged = { ...defaults, ...s };
    // fall back to build-time Google config when the user left fields blank
    for (const k of ['googleClientId', 'googleApiKey', 'googleAppId'] as const)
      if (!merged[k]) merged[k] = defaults[k];
    return merged;
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

/** Live tool state (shared between toolbar and input handling). */
export const toolState = {
  tool: 'pen' as ToolId,
  penColor: '#111111',
  penSize: 6, // screen px at the moment of drawing
  hlColor: '#ffeb3b',
  hlSize: 28,
  hlOpacity: 0.38,
  shapeKind: 'arrow' as ShapeKind,
  shapeColor: '#e53935',
  shapeSize: 6,
  shapeFill: false,
  textColor: '#111111',
  textSize: 36,
  noteColor: '#fff59d',
  stamp: '✓',
  stampColor: '#2e7d32',
  stampSize: 90,
  eraserSize: 30,
  /** 'partial' cuts through lines, 'stroke' removes whole marks */
  eraserMode: 'partial' as 'partial' | 'stroke',
};
