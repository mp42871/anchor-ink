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
| **Opens** | PDF · Word (.docx) · PowerPoint (.pptx) · Google Docs / Slides / Sheets (via Drive or downloaded as PDF) · images (PNG, JPG, GIF, WebP, BMP, SVG) · plain text · blank whiteboard, lined, graph and dot-grid paper |
| **Annotates** | Pressure-aware pen · highlighter · stroke eraser (or wipe with your palm) · lines, arrows, rectangles, ellipses · typed text · sticky notes · stamps (✓ ✗ ★ 👍 💯 ① ② ③ A+ …) · laser pointer · select / move / resize / duplicate / delete · undo & redo · add or remove pages |
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

* **One finger or pen** uses the current tool. **Two fingers** scroll and pinch-zoom.
  In *Settings → Touch* you can choose **Only the pen draws**, so fingers always
  scroll.
* Tap the active tool again to show its colours and sizes.
* The **⇄** button moves the toolbar to the other side of the screen, for whichever
  side you're standing on.
* **Select**: tap a mark to select it, or drag a box around several marks. Then drag
  to move, use the blue handle to resize, or use the 🗑 / ⧉ buttons. Double-tap text or a
  sticky note to edit it.
* Keyboard: `Ctrl+Z` / `Ctrl+Y`, `Delete`, `PgUp` / `PgDn`, `Ctrl+scroll` to zoom.

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

## Google Drive setup (optional)

Without this, teachers can still use Google files: *File → Download → PDF* in
Google Docs/Slides, then open the download. To open directly from Drive and save
back to Drive:

1. In <https://console.cloud.google.com> create (or choose) a project.
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen**: set it up as *Internal* (Workspace for Education) and add the
   scope `.../auth/drive.file`.
4. **Credentials → Create credentials → OAuth client ID** → *Web application*. Add your
   hosting URL (e.g. `https://yourschool.github.io`) under *Authorised JavaScript origins*.
5. **Credentials → Create credentials → API key** (restrict it to the Picker API and your site).
6. Put the Client ID, API key and **project number** in Anchor Ink under
   *Settings → Google Drive*. Or bake them into the build with the environment
   variables `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID`
   (repository *variables* `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID` for the
   Pages workflow).

The app only requests the `drive.file` scope, which means it can see only the
files a teacher explicitly picks or saves with it.

## How it works

* `src/viewer.ts`: continuous-scroll page viewer (pdf.js). Pages render lazily near the
  viewport at the right resolution for the current zoom, and are released when far away, so
  100+ page documents stay smooth.
* `src/editor.ts`: pointer and gesture engine and all the tools. It turns pointer input into
  page-space annotations, and handles two-finger pan/pinch, palm erase and undo history.
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
