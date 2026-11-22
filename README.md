# Anchor Ink

A touch-first document annotator built for large classroom interactive displays
(Clevertouch, Promethean, Newline, SMART, Viewsonic… 65–86"). Open a worksheet,
slide deck or PDF, mark it up with your finger or pen, and **every mark stays
glued to the spot on the document where you made it**, so you can scroll up and
down, zoom, jump between pages and come back to find your ink exactly where you
left it.

It runs in the board's web browser (or installs as an app). There's no server
and no account: documents stay on the board unless you choose to share them.

## What it does

| | |
|---|---|
| **Opens** | PDF · Word (.docx) · PowerPoint (.pptx) · Google Docs / Slides / Sheets (via Drive or downloaded as PDF) · images (PNG, JPG, GIF, WebP, BMP, SVG) · plain text · blank whiteboard, plus lined, handwriting, graph and dot-grid paper with adjustable spacing and orientation |
| **Annotates** | Pressure-aware pen · highlighter with adjustable opacity · eraser that rubs out part of a line or whole marks (or wipe with your palm) · preset and custom colours · lines, arrows, rectangles, ellipses · typed text · sticky notes · stamps (✓ ✗ ★ 👍 💯 ① ② ③ A+ …) · laser pointer · select / move / resize / duplicate / delete · undo & redo · add or remove pages |
| **Moves around** | Two-finger scroll and pinch-zoom while any tool is selected · page up/down buttons · page grid · fit width / whole page |
| **Saves** | Auto-saves every change on the board (Library on the home screen) · **Download PDF** · **Share / Email** (Gmail, Outlook, Teams, Classroom… through the device share sheet) · **Save to Google Drive** with a shareable link · page as PNG · print |

### Ink that stays anchored
Each page is drawn inside its own box, and every annotation is stored in that
page's own coordinates (PDF points), not screen pixels. Scrolling, zooming,
rotating the display or opening the file on another device all re-position the
ink with the page.

### Saved PDFs stay editable
**Download PDF** produces a normal PDF with your markup on each page, so it opens
in any PDF reader or email client. The same file also carries the clean original
and your annotations as hidden attachments. Open that PDF in Anchor Ink again,
on any board, and every pen stroke, note and text box comes back as an editable
annotation.

## Using it on the board

### Learning the app
* **Tutorial** (home screen): opens a 3-page practice sheet with tasks to try (circle, highlight,
  erase, stamp, arrow, sticky note, select, zoom, save) and walks through every tool with a
  guided tour. New users see a welcome banner offering it, and the tour runs automatically the
  first time any document is opened.
* **Help** (home screen and editor top bar): searchable topics covering every feature, plus
  troubleshooting and keyboard shortcuts. It can also replay the tour, open the practice
  sheet or start Pen setup.

### Writing with the Clevertouch pen
* The pen writes as soon as a document opens. No tool needs to be picked first.
* **Run Pen setup once per board** (home screen → *Pen setup*). Clevertouch's passive
  pens report to the browser as ordinary touches. The only difference is how big the
  contact is, so Pen setup has you write with the pen and then draw with a finger, and
  measures both. After that:
  * the **pen writes**,
  * **fingers scroll and pinch-zoom**,
  * a **hand resting on the board is ignored**, even in the middle of a pen stroke.
* If the board can't report contact size, Pen setup says so. The pen and fingers then
  both write, and two fingers scroll.
* Boards with an active stylus (reported as a real pen) are detected automatically.
  The pen's eraser end or side button erases.
* Ink is drawn on a low-latency canvas with pointer prediction so the line keeps up
  with the pen tip.
* *Settings → Pen & touch*: **Automatic** (default), **Only the pen writes**, or
  **Pen and fingers write**.

### Everything else
* Tap the active tool again to show its colours and sizes. The rainbow **+** swatch
  opens a large colour picker, and your recent custom colours are kept next to the presets.
* **Toolbar:** drag the dotted grip to move it anywhere. Drop it against the left or right
  edge to dock it there (pages then keep clear of it). **–** shrinks it to a single round
  button showing the current tool: tap the button to bring the toolbar back, or drag it
  out of the way. **Swap side** docks it on the other side.
* **Paper:** Lined, Graph and Dot grid ask for spacing (wide, college or narrow ruled;
  handwriting lines with a dashed midline; 5 mm to 2 cm grids; or any custom spacing) and
  portrait or landscape. **Add page** adds another sheet of the same paper.
* **Select**: tap a mark, or drag a box around several. Then drag to move, use the blue
  handle to resize, or 🗑 / ⧉. Double-tap text or a sticky note to edit it.
* Keyboard: `Ctrl+Z` / `Ctrl+Y`, `Delete`, `PgUp` / `PgDn`, `Ctrl+scroll` to zoom.

### Split screen and window resizing
The layout re-fits whenever the window changes size: Android split screen, a snapped
Windows window, or rotating the panel. Pages re-scale to the new width and keep your
place, and ink stays on the same words. The toolbar wraps into two columns in short
windows, and the page bar and top bar compact in narrow ones.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (it's also reachable from other devices on the network,
including the board). For a production build:

```bash
npm run build
```

`dist/` is a static site: host it anywhere (GitHub Pages, Netlify, the school web
server, a USB stick served locally). The included workflow
`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`
(enable it in *Settings → Pages → Source: GitHub Actions*).

### Install on the board
Open the hosted URL in Chrome / Edge on the board and choose **Install app** (or
*Add to home screen* on Android boards). It then opens full-screen, works
offline, and registers as a handler for PDF / Word / PowerPoint files.

## Google Drive

Teachers tap **Connect Google Drive** on the home screen once and sign in with
their school account. The board remembers them. After that, **Google Drive** opens
a full-size picker (My Drive, Shared drives, Starred, Recent; several files at once).
Google Docs, Slides, Sheets and Drawings are exported by Google as PDF, so the
layout matches exactly. PDFs, Word, PowerPoint and images on Drive work too.
**Save & share → Save to Google Drive** saves the marked-up PDF back to Drive with
a shareable link, and re-opening that PDF restores editable ink.

### One-time setup (IT or any teacher, ~10 minutes)
Google requires every web app to register its own sign-in key. Do this once for
the whole school:

1. In <https://console.cloud.google.com> (signed in with a school account) create a
   project called “Anchor Ink”.
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen**: user type **Internal** (Google Workspace for Education). With
   Internal no Google review is needed.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under
   *Authorised JavaScript origins* add the address the app is hosted at (shown in
   *Settings → Google Drive → Administrator setup*).
5. **Credentials → Create credentials → API key** (restrict it to the Picker API and your site).
6. In Anchor Ink: *Settings → Google Drive → Administrator setup*, paste the Client ID,
   API key and **project number**, then **Copy setup link for other boards**. Opening
   that link on any board (or emailing it to teachers) configures it in one tap.
   You can also bake the values into the build with the repository variables
   `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` and `GOOGLE_APP_ID`. The Pages workflow passes
   them in, so no board needs setup at all.

The hosted build ships with the school's Client ID, API key and project number in
`src/config.ts`, so boards need no setup: teachers just tap **Connect Google Drive**.
To use a different Google project, edit that file, set the repository variables, or
enter values under *Settings → Google Drive → Administrator setup* on a board.

The app asks only for the `drive.file` permission: it can see just the files a
teacher picks or saves with it. The Client ID and API key are public identifiers,
not passwords, which is why sharing them in a setup link is fine. Sign-in only works
on an `https://` address (or `localhost`), so host the app (e.g. GitHub Pages)
rather than opening the files directly.

## How it works

* `src/viewer.ts`: continuous-scroll page viewer (pdf.js). Pages render lazily near the
  viewport at the right resolution for the current zoom, and are released when far away, so
  100+ page documents stay smooth.
* `src/editor.ts`: pointer and gesture engine and all the tools. It turns pointer input into
  page-space annotations, and handles two-finger pan/pinch, palm rejection and undo history.
* `src/tour.ts`, `src/help.ts`, `src/practice.ts`: guided tour engine, help topics and the generated practice sheet.
* `src/input.ts` + `src/pensetup.ts`: classifies each contact as pen, finger or palm, and runs the Pen setup calibration.
* `src/annotations.ts`: annotation model, rendering (strokes via
  [perfect-freehand](https://github.com/steveruizok/perfect-freehand)) and hit-testing.
* `src/importers/`: everything becomes a PDF internally. Word is laid out with
  `docx-preview` and PowerPoint with `pptx-preview`, then each page is rasterised in
  the browser. Images and paper templates are generated with `pdf-lib`.
* `src/export.ts`: flattens annotations onto each page with `pdf-lib`, handling rotated
  pages, and embeds the editable project.
* `src/store.ts`: IndexedDB library, with auto-save.

### Limitations
* Word and PowerPoint are converted in the browser. Complex layouts (SmartArt, some
  charts, unusual fonts) may look slightly different from Office. For pixel-perfect
  results, export to PDF from Office or Google first.
* Old binary formats (.doc, .ppt, .xls) aren't supported. Save them as .docx / .pptx / PDF.
* Annotations on Word/PowerPoint imports sit on page images, so the exported PDF's text
  isn't selectable for those files. Real PDFs keep their selectable text.
