import { icon } from './icons';
import { h, modal } from './ui';

interface HelpActions {
  tour?: () => void;
  practice?: () => void;
  penSetup?: () => void;
}

const TOPICS: [string, string, string][] = [
  ['start', 'Getting started', `
    <ol>
      <li><b>Open something.</b> On the home screen tap <b>Open a file</b> (PDF, Word, PowerPoint, images) or <b>Google Drive</b>.
        You can also drag a file from a USB drive onto the screen. Or start a <b>Whiteboard</b>, <b>Lined</b>, <b>Graph</b> or <b>Dot grid</b> page.</li>
      <li><b>Write on it.</b> The pen is ready straight away. Just write.</li>
      <li><b>Move around.</b> Two fingers scroll and pinch-zoom. Your ink stays exactly where you wrote it on the document.</li>
      <li><b>Done.</b> Everything saves on this board automatically. Find it again under <b>Recent documents</b> on the home screen.
        Use <b>Save / Share</b> to download, email or print it.</li>
    </ol>`],
  ['pen', 'Writing with the pen', `
    <p>Tap <b>Pen</b> on the toolbar, then write. Tap <b>Pen</b> again to change colour and thickness.</p>
    <p><b>Run Pen setup once per board</b> (home screen → <b>Pen setup</b>). It learns the difference between the
      Clevertouch pen and your finger, so that:</p>
    <ul><li>the pen writes,</li><li>fingers scroll and zoom,</li><li>your hand resting on the board is ignored.</li></ul>
    <p>Choose how touch behaves in <b>Settings → Pen &amp; touch</b>:</p>
    <ul>
      <li><b>Automatic</b>: the pen writes. Fingers scroll once the board can tell them apart.</li>
      <li><b>Only the pen writes</b>: fingers always scroll.</li>
      <li><b>Pen and fingers write</b>: use two fingers to scroll.</li>
    </ul>`],
  ['move', 'Scrolling, zooming & pages', `
    <ul>
      <li><b>Scroll:</b> drag with two fingers, or pick the <b>Scroll</b> (hand) tool and drag with one.</li>
      <li><b>Zoom:</b> pinch with two fingers, or use <b>−</b> and <b>+</b> on the page bar at the bottom.
        Tap the zoom label to switch between <b>Fit width</b> and <b>Whole page</b>.</li>
      <li><b>Pages:</b> the <b>˄ ˅</b> arrows go to the previous or next page. The grid button shows every page, and you can tap one to jump to it or remove it.</li>
      <li><b>Add a blank page</b> after the current one with the page-plus button. On lined or graph paper it adds the same paper.</li>
    </ul>`],
  ['colours', 'Colours, thickness & highlighter', `
    <ul>
      <li>Tap the selected tool again to open its options.</li>
      <li>The rainbow <b>+</b> opens a large colour picker. Drag in the square and along the rainbow bar, then tap <b>Use colour</b>.
        Colours you pick are kept next to the presets.</li>
      <li><b>Highlighter:</b> choose a colour, width and <b>opacity</b>. Lower opacity is more see-through.</li>
    </ul>`],
  ['erase', 'Erasing & undo', `
    <ul>
      <li>Choose <b>Eraser</b>, then rub over the ink.</li>
      <li><b>Part of a line</b> removes only what the eraser touches. <b>Whole marks</b> removes the whole line, shape or note in one touch.</li>
      <li>Pick a larger eraser size for big areas. <b>Clear this page</b> removes every mark on the page.</li>
      <li>Made a mistake? <b>Undo</b> and <b>Redo</b> are on the toolbar (or press Ctrl+Z / Ctrl+Y).</li>
      <li>If the pen has an eraser end or side button, that erases too.</li>
    </ul>`],
  ['tools', 'Shapes, text, sticky notes & stamps', `
    <ul>
      <li><b>Shapes:</b> choose line, arrow, rectangle or ellipse, then drag. Lines snap to straight and 45° when close.</li>
      <li><b>Text:</b> tap the page and type with the on-screen keyboard. Tap elsewhere when finished.
        Tap the text again with the Text tool to edit it.</li>
      <li><b>Sticky:</b> tap to add a note, then type.</li>
      <li><b>Stamp:</b> pick a stamp (✓ ✗ ★ 👍 …), colour and size, then tap where it should go.</li>
      <li><b>Laser:</b> point things out to the class. The red trail fades away and is never saved.</li>
    </ul>`],
  ['select', 'Moving, resizing & deleting marks', `
    <ul>
      <li>Choose <b>Select</b>. Tap a mark, or drag a box around several marks.</li>
      <li>Drag inside the dashed box to move the marks. Drag the blue dot to resize them.</li>
      <li>Use 🗑 to delete or ⧉ to duplicate. Double-tap text or a sticky note to edit it.</li>
    </ul>`],
  ['toolbar', 'The toolbar', `
    <ul>
      <li><b>Move it:</b> drag the dotted grip at its top. Drop it against the left or right edge to dock it there,
        so the page moves out of its way. Or leave it floating anywhere.</li>
      <li><b>Shrink it:</b> tap <b>−</b>. It becomes one round button showing your current tool.
        Tap that button to bring the toolbar back, or drag it out of the way.</li>
      <li><b>Swap side</b> docks it on the other side, for wherever you are standing.</li>
    </ul>`],
  ['paper', 'Whiteboard & paper', `
    <p>On the home screen, <b>Lined paper</b>, <b>Graph paper</b> and <b>Dot grid</b> let you choose:</p>
    <ul>
      <li><b>Line style:</b> wide, college, narrow or extra-wide ruled, or <b>handwriting</b> lines with a dashed middle line in three sizes.</li>
      <li><b>Square or dot size:</b> 5 mm, ¼ inch, 1 cm, ½ inch or 2 cm.</li>
      <li><b>Any custom spacing</b> with the slider.</li>
      <li><b>Portrait or landscape.</b></li>
    </ul>`],
  ['save', 'Saving, sharing & printing', `
    <ul>
      <li><b>Automatic:</b> every change is saved on this board. Reopen documents from <b>Recent documents</b> on the home screen.</li>
      <li><b>Save / Share</b> (top right):
        <ul>
          <li><b>Download PDF</b> gives a normal PDF with your markup. Open that PDF here again later and you can keep editing the ink.</li>
          <li><b>Share / Email</b> sends it with Gmail, Outlook, Teams or Classroom.</li>
          <li><b>Save to Google Drive</b> saves it and gives you a link to share.</li>
          <li><b>This page as image</b> and <b>Print</b>.</li>
        </ul></li>
      <li>Rename a document by tapping its title at the top.</li>
    </ul>`],
  ['drive', 'Google Drive', `
    <ul>
      <li>Tap <b>Connect Google Drive</b> on the home screen once and sign in with your school account. The board remembers you.</li>
      <li>Then tap <b>Google Drive</b> to pick Docs, Slides, Sheets, PDFs, Word or PowerPoint files. You can pick several at once.</li>
      <li>To sign out, go to <b>Settings → Google Drive → Disconnect</b>. Do this on shared boards when you're finished.</li>
      <li>If it says <i>Set up Google Drive</i>, your school needs a one-time setup: <b>Settings → Google Drive → Administrator setup</b>,
        or open the setup link from your IT team.</li>
    </ul>`],
  ['split', 'Split screen', `
    <p>Anchor Ink works in a half-screen or smaller window. Pages re-fit to the window and keep your place.
      The toolbar wraps into two columns if the window is short, and you can drag or shrink it to save room.</p>`],
  ['trouble', 'Troubleshooting', `
    <dl>
      <dt>My hand or arm leaves marks while I write.</dt>
      <dd>Run <b>Pen setup</b> from the home screen. Afterwards a resting hand is ignored.</dd>
      <dt>The pen doesn't write.</dt>
      <dd>Check that <b>Pen</b> (not Scroll or Select) is highlighted on the toolbar. If the toolbar is shrunk, tap the round button to open it.</dd>
      <dt>Fingers draw instead of scrolling.</dt>
      <dd>Use two fingers to scroll, or choose <b>Only the pen writes</b> in Settings. Pen setup also fixes this on most boards.</dd>
      <dt>Pen setup says the pen and finger look the same.</dt>
      <dd>Some boards don't report touch size. Both will write; use two fingers to scroll, or the Scroll tool.</dd>
      <dt>Google sign-in doesn't appear.</dt>
      <dd>Allow pop-ups for this site in the browser, then try again.</dd>
      <dt>A Word or PowerPoint file looks slightly different.</dt>
      <dd>For an exact match, save it as PDF from Word, PowerPoint or Google first, then open the PDF.</dd>
      <dt>A .doc, .ppt or .xls file won't open.</dt>
      <dd>Older formats aren't supported. Save the file as .docx, .pptx or PDF first.</dd>
      <dt>I can't find my work.</dt>
      <dd>It's under <b>Recent documents</b> on the home screen of the same board. To use it on another board, Download, email or save it to Drive, then open it there.</dd>
      <dt>New features aren't showing.</dt>
      <dd>Close and reopen the app (or refresh the page) once or twice. The app updates itself in the background.</dd>
    </dl>`],
  ['keys', 'Keyboard shortcuts', `
    <ul>
      <li><b>Ctrl+Z</b> undo · <b>Ctrl+Y</b> or <b>Ctrl+Shift+Z</b> redo</li>
      <li><b>Delete</b> removes the selected marks · <b>Esc</b> clears the selection</li>
      <li><b>Page Up / Page Down</b> previous / next page · <b>Ctrl + mouse wheel</b> zoom</li>
    </ul>`],
];

export function showHelp(actions: HelpActions = {}, openTopic?: string) {
  const body = h(`<div class="help">
    <div class="help-actions">
      ${actions.tour ? `<button class="btn primary" data-h="tour">${icon('select')}<span>Take the tour</span></button>` : ''}
      ${actions.practice ? `<button class="btn" data-h="practice">${icon('pen')}<span>Practice sheet</span></button>` : ''}
      ${actions.penSetup ? `<button class="btn" data-h="pen">${icon('settings')}<span>Pen setup</span></button>` : ''}
    </div>
    <input class="input help-search" type="search" placeholder="Search help (e.g. erase, Google, zoom)…">
    <div class="help-topics">${TOPICS.map(([id, title, html]) => `
      <details class="help-topic" data-id="${id}" ${id === (openTopic || 'start') ? 'open' : ''}>
        <summary>${title}</summary><div class="help-body">${html}</div>
      </details>`).join('')}
    </div>
    <p class="muted help-none" hidden>No help topics match. Try a different word.</p>
  </div>`);
  const m = modal('Help', body, { wide: true });
  body.querySelector('[data-h=tour]')?.addEventListener('click', () => { m.close(); actions.tour!(); });
  body.querySelector('[data-h=practice]')?.addEventListener('click', () => { m.close(); actions.practice!(); });
  body.querySelector('[data-h=pen]')?.addEventListener('click', () => { m.close(); actions.penSetup!(); });
  const search = body.querySelector<HTMLInputElement>('.help-search')!;
  const topics = Array.from(body.querySelectorAll<HTMLDetailsElement>('.help-topic'));
  const openState = new Map(topics.map((t) => [t, t.open]));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const t of topics) {
      if (!q) { t.hidden = false; t.open = openState.get(t)!; shown++; continue; }
      const hit = (t.textContent || '').toLowerCase().includes(q);
      t.hidden = !hit;
      t.open = hit;
      if (hit) shown++;
    }
    body.querySelector<HTMLElement>('.help-none')!.hidden = shown > 0;
  });
  topics.forEach((t) => t.addEventListener('toggle', () => { if (!search.value) openState.set(t, t.open); }));
}
