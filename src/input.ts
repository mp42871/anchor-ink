import { settings } from './settings';

/**
 * Works out what touched the board.
 *
 * Clevertouch and most other IR / PCAP classroom panels report the passive pen
 * as an ordinary touch. The only thing that tells it apart from a finger is the
 * contact size, so Pen setup measures both and stores a threshold. Boards with
 * an active stylus report pointerType "pen" and need no setup.
 */
export type Contact = 'pen' | 'finger' | 'palm' | 'mouse';

let stylusSeen = false;

export function size(e: PointerEvent) {
  return Math.max(e.width || 0, e.height || 0);
}

export function classify(e: PointerEvent): Contact {
  if (e.pointerType === 'mouse') return 'mouse';
  if (e.pointerType === 'pen') {
    stylusSeen = true;
    return 'pen';
  }
  const s = size(e);
  if (settings.penMaxSize > 0 && s > 0) {
    if (s <= settings.penMaxSize) return 'pen';
    const palm = Math.max(settings.fingerSize * 2.2, settings.penMaxSize * 4, 40);
    if (s >= palm) return 'palm';
    return 'finger';
  }
  // not calibrated: only an unmistakably huge contact counts as a palm
  if (settings.palmErase && s >= 70) return 'palm';
  return 'finger';
}

/** Can this board currently tell the pen apart from fingers? */
export function penDistinguishable() {
  return stylusSeen || settings.penMaxSize > 0;
}

/** Should a finger draw (true) or scroll (false)? */
export function fingerDraws() {
  if (settings.drawWith === 'all') return true;
  if (settings.drawWith === 'pen') return false;
  return !penDistinguishable();
}
