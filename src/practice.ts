import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A 3-page hands-on practice sheet (16:9, fills the board) used by the tutorial. */
export async function practicePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 1600, H = 900;
  const ink = rgb(0.11, 0.14, 0.2), muted = rgb(0.4, 0.45, 0.53), accent = rgb(0.1, 0.4, 0.85), box = rgb(0.8, 0.84, 0.9);

  const page = (title: string, sub: string) => {
    const p = pdf.addPage([W, H]);
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    p.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
    p.drawText(title, { x: 70, y: H - 95, size: 46, font: bold, color: ink });
    p.drawText(sub, { x: 70, y: H - 140, size: 24, font, color: muted });
    return p;
  };
  const task = (p: ReturnType<typeof page>, n: number, y: number, text: string, hint: string) => {
    p.drawCircle({ x: 92, y: y + 12, size: 22, color: accent });
    p.drawText(String(n), { x: n > 9 ? 80 : 85, y: y + 3, size: 24, font: bold, color: rgb(1, 1, 1) });
    p.drawText(text, { x: 130, y, size: 30, font: bold, color: ink });
    p.drawText(hint, { x: 130, y: y - 34, size: 20, font, color: muted });
  };

  // page 1
  let p = page('Practice sheet', 'Try each task. Nothing here can break. Undo is on the toolbar.');
  task(p, 1, 640, 'Pen: circle the word below.', 'Pick up the pen and draw a circle around it.');
  p.drawText('APPLE', { x: 180, y: 540, size: 64, font: bold, color: rgb(0.8, 0.15, 0.15) });
  task(p, 2, 430, 'Highlighter: highlight this sentence.', 'Choose Highlight on the toolbar, then drag across the words.');
  p.drawText('The quick brown fox jumps over the lazy dog.', { x: 180, y: 345, size: 36, font, color: ink });
  task(p, 3, 240, 'Eraser: write your name in the box, then rub out one letter.', 'Choose Eraser. "Part of a line" removes only what it touches.');
  p.drawRectangle({ x: 180, y: 50, width: 700, height: 130, borderColor: box, borderWidth: 3 });
  p.drawText('Scroll down with two fingers for more', { x: 1010, y: 70, size: 24, font, color: accent });

  // page 2
  p = page('Keep going', 'You scrolled! Your marks on page 1 moved with the page. That is anchored ink.');
  task(p, 4, 640, 'Stamp: put a tick next to the correct answer.', 'Choose Stamp, pick the tick, then tap next to the answer.');
  p.drawText('2 + 2 = 4', { x: 200, y: 560, size: 40, font, color: ink });
  p.drawText('2 + 2 = 5', { x: 560, y: 560, size: 40, font, color: ink });
  task(p, 5, 450, 'Shapes: draw an arrow from the star to the box.', 'Choose Shapes, then the arrow, and drag from start to end.');
  p.drawText('*', { x: 210, y: 300, size: 120, font: bold, color: rgb(0.95, 0.65, 0.05) });
  p.drawRectangle({ x: 820, y: 300, width: 120, height: 100, borderColor: ink, borderWidth: 3 });
  task(p, 6, 200, 'Sticky note & text: add a note for your class.', 'Choose Sticky (or Text), tap the page and type. Tap elsewhere when done.');

  // page 3
  p = page('Last page', 'Now try moving around and saving.');
  task(p, 7, 640, 'Select: move or resize something you drew.', 'Choose Select, tap a mark, drag it. Use the blue handle to resize.');
  task(p, 8, 500, 'Zoom: pinch with two fingers, or use + and - at the bottom.', 'Tap the zoom label to switch between "Fit width" and "Whole page".');
  task(p, 9, 360, 'Toolbar: drag the dots at its top to move it, or - to shrink it.', 'Drop it against the left or right edge to dock it there.');
  task(p, 10, 220, 'Save: tap Save / Share to download a PDF or email it.', 'Your work is also saved on this board automatically.');
  p.drawText('Need a reminder later? Tap the ? Help button at the top of the screen.', { x: 70, y: 70, size: 24, font: bold, color: accent });
  return pdf.save();
}
