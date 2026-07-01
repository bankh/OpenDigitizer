# OpenDigitizer — changes vs upstream WebPlotDigitizer v5.3.0

This fork preserves the original AGPL-3.0 license and Ankit Rohatgi's copyright.
All additions are marked with `OpenDigitizer:` comments in the source.

## New features

### 1. Manual mode: multiple selection & deletion
- `javascript/tools/manualDetectionTools.js` — `AdjustDataPointTool`:
  - `_deleteSelectedPoints()` deletes **all** selected points at once, in
    descending index order with `refreshTuplesAfterPixelRemoval`, so point-group
    tuples stay valid. Wired to Del/Backspace for any selection size (upstream
    only deleted a single selected point).
  - Additive/toggle selection: Shift/Ctrl/Cmd-click toggles a point in the
    selection; Shift-drag adds a rectangle to the existing selection
    (`onMouseDown`/`onMouseClick`).
- `javascript/core/dataset.js` — added `unselectPixel(index)`.

### 2. Point-level Undo / Redo
- `javascript/core/dataset.js` — `getDataPointsState()` / `applyDataPointsState()`
  (deep snapshots of points, tuples, selections, metadata bookkeeping).
- `javascript/controllers/manualDetection.js` — bounded snapshot undo/redo stack
  (`recordUndoSnapshot`, `undoPoints`, `redoPoints`, `handleUndoRedoKey`),
  reset per dataset session. Recorded on add, delete (single + multi), and clear.
- Bound to Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z (redo) inside the
  acquire tools, plus Undo/Redo buttons in the acquire sidebar.

### 3. Keyboard placement mode
- `javascript/controllers/manualDetection.js` — keyboard-mode state + virtual
  cursor (`isKeyboardMode`, `toggleKeyboardMode`, get/set cursor).
- `javascript/tools/manualDetectionTools.js` — `ManualSelectionTool` rewritten to
  share an `addPointAt()` routine between mouse and keyboard, draw a crosshair via
  `onRedraw`, move it with arrows (rotation-aware, Shift = faster), add with `A`,
  and navigate points with `Z`/`C`. `K` toggles the mode (tool-switch on `a` is
  suppressed while in keyboard mode so `A` means "add").
- `javascript/widgets/graphicsWidget.js` — added `setCanvasFocus()` so clicking
  the sidebar toggle doesn't blur the canvas and break keystrokes.

### 4. Folder / thumbnail image browser
- `javascript/widgets/imageBrowser.js` (new) — `wpd.imageBrowser`: folder picker
  (`webkitdirectory`), thumbnail strip, hover large-preview, click-to-switch.
- `javascript/controllers/imageManager.js` — added `loadFiles(files)`.
- `templates/_popups.html` — "Open Folder" button in the Load Image dialog.

### 5. Open, pluggable CV/AI extension seam
- `javascript/core/detectorRegistry.js` (new) — `wpd.detectorRegistry`
  (register/getForAxes/createAlgo), the single contact point for new detectors.
- `javascript/core/curve_detection/exampleColumnDetector.js` (new) — worked,
  self-registering local-JS detector ("Column Average (example)").
- `javascript/services/remoteDetector.js` (new) — `wpd.RemoteDetector`, an async
  HTTP adapter for self-hosted Python/other backends.
- `javascript/controllers/autoDetection.js` — `algoManager` now appends registry
  detectors to the dropdown, instantiates them on selection, restores them by
  `detectorId`, and treats any `isAsync` detector like the template matcher.
- `docs/EXTENDING-CV-AI.md` (new) — the detector interface + data contract, with
  JS / WASM / Python recipes and a reference FastAPI server.

## Branding / meta
- `package.json` name/version/description; `templates/_base.html` page title;
  `README.md` + this file. Original copyright/license preserved.
- `templates/dev.html` — registered the new scripts in load-order-safe positions.

## Verification performed
- `node --check` on every changed/new JS file and on the full concatenated bundle.
- `renderHTML.py` renders all pages in all 6 locales without error.
- A Node `vm` harness exercising the new logic: registry + load-order
  self-registration, the example detector's output, undo snapshot round-trip +
  deep-copy independence, `unselectPixel`, and tuple-safe batch delete + undo
  restore — 25/25 checks passing.
- Not yet done: interactive in-browser smoke test (no headless browser available
  in this environment).
