# Extending OpenDigitizer with custom CV / AI detectors

OpenDigitizer keeps the computer-vision / AI extraction layer **open and
pluggable**. New detectors register themselves with a small registry and then
appear in the *Automatic Extraction → Algorithm* dropdown alongside the
built-in algorithms. A detector can run:

1. **Purely in the browser (JavaScript)** — e.g. classic CV with plain JS, or
   `OpenCV.js`.
2. **In the browser via WASM** — e.g. a trained model with `onnxruntime-web` or
   `TensorFlow.js`.
3. **In a remote service (Python, etc.)** — e.g. a FastAPI server running
   OpenCV / scikit-image / PyTorch, reached over HTTP.

All three implement the **same interface** and exchange data through the **same
contract**, so they are interchangeable.

> Licensing note: the OpenDigitizer frontend is AGPL-3.0 (inherited from
> WebPlotDigitizer). Code you bundle into the frontend inherits AGPL. A separate
> backend reached over a clean HTTP API can be licensed independently — keep the
> model behind the network boundary if you need that flexibility.

---

## 1. The detector interface

A detector is any object/class with these methods:

```js
getParamList(axes)   // -> { key: [label, unit, defaultValue], ... }
setParams(params)    // params is an object keyed by the getParamList keys
run(autoDetector, dataSeries, axes, imageData)   // synchronous detectors
```

Optional (recommended) for save/resume:

```js
getParams()          // -> { key: value, ... }
serialize()          // -> plain object (or null if never run)
deserialize(obj)     // restore from serialize() output
```

For **asynchronous** detectors (WASM workers, remote HTTP), set a flag and a
completion callback instead of finishing inside `run()`:

```js
this.isAsync = true;
setOnCompleteCallback(fn)   // store fn; call it once detection has finished
run(autoDetector, dataSeries, axes, imageData)  // kicks off async work, calls fn() when done
```

## 2. The data contract

**Inputs** available inside `run()`:

| Source | What it is |
|---|---|
| `autoDetector.binaryData` | `Set` of foreground pixel indices, where index = `y * imageWidth + x`. This is the color mask the user built (foreground/background color + distance + ROI). |
| `autoDetector.imageWidth` / `autoDetector.imageHeight` | source image dimensions in pixels |
| `imageData` | the raw `ImageData` (RGBA) of the source image |
| `axes` | the active axes object (e.g. `wpd.XYAxes`); usually you do **not** need it |
| `wpd.graphicsWidget.getBase64Image()` | base64 PNG of the source image (handy for remote backends) |

**Output**: write results with

```js
dataSeries.clearAll();                       // usually replace previous output
dataSeries.addPixel(x, y);                   // x, y in IMAGE PIXELS
dataSeries.addPixel(x, y, { area: 12.3 });   // optional per-point metadata
```

**Coordinates are always image pixels.** OpenDigitizer converts pixels → data
values through the calibrated axes for you, so detectors never deal with axis
math, log scales, dates, etc.

## 3. Registering a detector

```js
wpd.detectorRegistry.register({
    id: 'myDetector',                 // unique; avoid built-in ids
    name: 'My Detector',              // shown in the dropdown
    axesTypes: ['XYAxes'],            // or '*' for all axis types
    createAlgo: () => new MyDetector()
});
```

Built-in ids to avoid: `averagingWindow`, `XStep`, `XStepWithInterpolation`,
`CustomIndependents`, `blobDetector`, `barExtraction`, `histogram`,
`templateMatcher`.

`axesTypes` is matched against the axis class name
(`XYAxes`, `BarAxes`, `PolarAxes`, `TernaryAxes`, `MapAxes`, `ImageAxes`,
`CircularChartRecorderAxes`).

## 4. Worked example (local JS)

See [`javascript/core/curve_detection/exampleColumnDetector.js`](../javascript/core/curve_detection/exampleColumnDetector.js):
a complete ~40-line detector that averages the masked pixels in each image
column. It self-registers at the bottom of the file and shows up as
**"Column Average (example)"** for XY plots. Copy it as a template.

To add your own as a new file, drop it in `javascript/core/curve_detection/`
(the build globs that folder) and, for the dev page, add a `<script>` tag to
`templates/dev.html` **after** `detectorRegistry.js`.

## 5. Remote (Python) detectors

[`javascript/services/remoteDetector.js`](../javascript/services/remoteDetector.js)
provides `wpd.RemoteDetector`, an async adapter that POSTs the image + mask +
params to an HTTP endpoint and reads back points. Register it pointing at your
own server:

```js
wpd.detectorRegistry.register({
    id: 'myModel',
    name: 'My Model (remote)',
    axesTypes: '*',
    createAlgo: () => new wpd.RemoteDetector({
        endpoint: 'http://localhost:8000/detect',
        name: 'My Model'
    })
});
```

**Request** (POST JSON):

```json
{
  "image":  "<base64 PNG>",
  "width":  1024,
  "height": 768,
  "mask":   [12345, 12346, ...],
  "params": { "threshold": 0.5 },
  "axesType": "XYAxes"
}
```

**Response** (JSON, image-pixel coordinates):

```json
{ "points": [ {"x": 100.5, "y": 220.0}, {"x": 110.5, "y": 215.2, "metadata": {"conf": 0.9}} ] }
```

### Reference Python server (FastAPI)

```python
# pip install fastapi uvicorn pillow numpy
import base64, io
import numpy as np
from PIL import Image
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class DetectRequest(BaseModel):
    image: str
    width: int
    height: int
    mask: list[int] = []
    params: dict = {}
    axesType: str | None = None

@app.post("/detect")
def detect(req: DetectRequest):
    # decode the image if your model needs raw pixels
    raw = base64.b64decode(req.image.split(",")[-1])
    img = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))

    # --- your OpenCV / scikit-image / PyTorch detection goes here ---
    # The mask (foreground pixel indices) is available as req.mask:
    #   ys, xs = np.divmod(np.array(req.mask), req.width)
    # Return points in IMAGE-PIXEL coordinates.
    points = [{"x": x + 0.5, "y": float(ys[xs == x].mean()) + 0.5}
              for x in np.unique(xs)] if req.mask else []

    return {"points": points}
```

Run with `uvicorn server:app --port 8000`, then register `wpd.RemoteDetector`
pointed at `http://localhost:8000/detect`.

## 6. How it plugs into the app

- `wpd.detectorRegistry` ([`javascript/core/detectorRegistry.js`](../javascript/core/detectorRegistry.js)) holds the descriptors.
- `wpd.algoManager` ([`javascript/controllers/autoDetection.js`](../javascript/controllers/autoDetection.js)) appends registry detectors to the dropdown, instantiates them on selection, renders their `getParamList`, and runs them — treating `isAsync` detectors like the template matcher.

No core code needs to change to add a detector — registration is the only
contact point.
