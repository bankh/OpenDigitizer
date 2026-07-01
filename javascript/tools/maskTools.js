/*
    WebPlotDigitizer - web based chart data extraction software (and more)
    
    Copyright (C) 2025 Ankit Rohatgi

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

var wpd = wpd || {};

// OpenDigitizer: read the current pen/erase brush width. Prefers the numeric
// input (which can exceed the slider cap); falls back to the slider.
wpd.getMaskWidth = function(mode) {
    const numId = (mode === 'erase') ? 'eraseThicknessNum' : 'paintThicknessNum';
    const sliderId = (mode === 'erase') ? 'eraseThickness' : 'paintThickness';
    const el = document.getElementById(numId) || document.getElementById(sliderId);
    let w = el ? parseInt(el.value, 10) : 20;
    if (isNaN(w) || w < 1) {
        w = 1;
    }
    return w;
};

// OpenDigitizer: keyboard-driven mask painting for the Pen/Erase tools.
// Toggled with "X" (extraction keyboard). Arrow keys move a brush crosshair
// (Shift = faster); Space toggles the brush down/up (pen-down toggle) so the
// mask is highlighted / erased as the crosshair moves. State is shared across
// the Pen and Erase tool instances (which are recreated on each activation).
wpd.maskKeyboard = (function() {
    let enabled = false;
    let penDown = false;
    let cursor = null; // {x, y} in image pixels
    let mode = 'pen'; // 'pen' | 'erase'

    function isEnabled() {
        return enabled;
    }

    function setMode(m) {
        mode = m;
    }

    function _initCursor() {
        const s = wpd.graphicsWidget.getImageSize();
        cursor = {
            x: s.width / 2,
            y: s.height / 2
        };
    }

    function _applyBrushStyle() {
        const ctx = wpd.graphicsWidget.getAllContexts();
        const w = wpd.getMaskWidth(mode);
        const zoom = wpd.graphicsWidget.getZoomRatio();
        if (mode === 'erase') {
            ctx.dataCtx.globalCompositeOperation = 'destination-out';
            ctx.oriDataCtx.globalCompositeOperation = 'destination-out';
            ctx.dataCtx.strokeStyle = ctx.dataCtx.fillStyle = 'rgba(0,0,0,1)';
            ctx.oriDataCtx.strokeStyle = ctx.oriDataCtx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.dataCtx.globalCompositeOperation = 'xor';
            ctx.oriDataCtx.globalCompositeOperation = 'xor';
            ctx.dataCtx.strokeStyle = ctx.dataCtx.fillStyle = 'rgba(255,255,0,0.5)';
            ctx.oriDataCtx.strokeStyle = ctx.oriDataCtx.fillStyle = 'rgba(255,255,0,0.5)';
        }
        ctx.dataCtx.lineWidth = w * zoom;
        ctx.oriDataCtx.lineWidth = w;
        ctx.dataCtx.lineCap = ctx.dataCtx.lineJoin = 'round';
        ctx.oriDataCtx.lineCap = ctx.oriDataCtx.lineJoin = 'round';
        return {
            ctx: ctx,
            w: w
        };
    }

    function _dab() {
        // stamp a filled circle at the cursor so a stationary brush marks a dot
        const {
            ctx,
            w
        } = _applyBrushStyle();
        const cp = wpd.graphicsWidget.imageToCanvasPx(cursor.x, cursor.y);
        const zoom = wpd.graphicsWidget.getZoomRatio();
        ctx.dataCtx.beginPath();
        ctx.dataCtx.arc(cp.x, cp.y, Math.max(0.5, w * zoom / 2), 0, 2 * Math.PI);
        ctx.dataCtx.fill();
        ctx.oriDataCtx.beginPath();
        ctx.oriDataCtx.arc(cursor.x, cursor.y, Math.max(0.5, w / 2), 0, 2 * Math.PI);
        ctx.oriDataCtx.fill();
        _resetComposite();
    }

    function _beginStroke() {
        const {
            ctx
        } = _applyBrushStyle();
        const cp = wpd.graphicsWidget.imageToCanvasPx(cursor.x, cursor.y);
        ctx.dataCtx.beginPath();
        ctx.dataCtx.moveTo(cp.x, cp.y);
        ctx.oriDataCtx.beginPath();
        ctx.oriDataCtx.moveTo(cursor.x, cursor.y);
        _dab(); // mark the starting point
        _applyBrushStyle(); // _dab reset the composite; re-arm for the stroke
        ctx.dataCtx.beginPath();
        ctx.dataCtx.moveTo(cp.x, cp.y);
        ctx.oriDataCtx.beginPath();
        ctx.oriDataCtx.moveTo(cursor.x, cursor.y);
    }

    function _paintTo(nx, ny) {
        const ctx = wpd.graphicsWidget.getAllContexts();
        const cp = wpd.graphicsWidget.imageToCanvasPx(nx, ny);
        ctx.dataCtx.lineTo(cp.x, cp.y);
        ctx.dataCtx.stroke();
        ctx.oriDataCtx.lineTo(nx, ny);
        ctx.oriDataCtx.stroke();
    }

    function _resetComposite() {
        const ctx = wpd.graphicsWidget.getAllContexts();
        ctx.dataCtx.closePath();
        ctx.oriDataCtx.closePath();
        ctx.dataCtx.lineWidth = 1;
        ctx.oriDataCtx.lineWidth = 1;
        ctx.dataCtx.globalCompositeOperation = 'source-over';
        ctx.oriDataCtx.globalCompositeOperation = 'source-over';
    }

    function _endStroke() {
        _resetComposite();
    }

    function _drawCursor() {
        if (!enabled || cursor == null) {
            return;
        }
        wpd.graphicsWidget.resetHover();
        const ctx = wpd.graphicsWidget.getAllContexts().hoverCtx;
        const cp = wpd.graphicsWidget.imageToCanvasPx(cursor.x, cursor.y);
        const r = Math.max(3, wpd.getMaskWidth(mode) * wpd.graphicsWidget.getZoomRatio() / 2);
        // brush footprint (red = brush down, blue = up)
        ctx.beginPath();
        ctx.strokeStyle = penDown ? 'rgba(220,0,0,0.95)' : 'rgba(0,120,255,0.95)';
        ctx.lineWidth = 1;
        ctx.arc(cp.x, cp.y, r, 0, 2 * Math.PI);
        ctx.stroke();
        // crosshair
        ctx.beginPath();
        ctx.moveTo(cp.x - 8, cp.y);
        ctx.lineTo(cp.x + 8, cp.y);
        ctx.moveTo(cp.x, cp.y - 8);
        ctx.lineTo(cp.x, cp.y + 8);
        ctx.stroke();
    }

    function toggle() {
        if (enabled) {
            if (penDown) {
                _endStroke();
            }
            enabled = false;
            penDown = false;
            wpd.graphicsWidget.resetHover();
        } else {
            enabled = true;
            penDown = false;
            if (cursor == null) {
                _initCursor();
            }
            wpd.graphicsWidget.setCanvasFocus(true);
            wpd.graphicsWidget.updateZoomToImagePosn(cursor.x, cursor.y);
            _drawCursor();
        }
    }

    function _togglePenDown() {
        if (!enabled) {
            return;
        }
        penDown = !penDown;
        if (penDown) {
            _beginStroke();
        } else {
            _endStroke();
        }
        _drawCursor();
    }

    // returns true if the event was handled
    function handleKeyDown(ev) {
        // K or X toggles keyboard masking (K matches the manual-mode key)
        if (wpd.keyCodes.isAlphabet(ev.keyCode, 'k') || wpd.keyCodes.isAlphabet(ev.keyCode, 'x')) {
            toggle();
            ev.preventDefault();
            return true;
        }
        if (!enabled) {
            return false;
        }
        if (ev.keyCode === 32) { // Space -> brush down/up
            _togglePenDown();
            ev.preventDefault();
            return true;
        }
        const step = (ev.shiftKey ? 10 : 1) / wpd.graphicsWidget.getZoomRatio();
        let nx = cursor.x,
            ny = cursor.y,
            moved = false;
        if (wpd.keyCodes.isUp(ev.keyCode)) {
            ny -= step;
            moved = true;
        } else if (wpd.keyCodes.isDown(ev.keyCode)) {
            ny += step;
            moved = true;
        } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
            nx -= step;
            moved = true;
        } else if (wpd.keyCodes.isRight(ev.keyCode)) {
            nx += step;
            moved = true;
        }
        if (moved) {
            cursor = {
                x: nx,
                y: ny
            };
            if (penDown) {
                _paintTo(nx, ny);
            }
            _drawCursor();
            wpd.graphicsWidget.updateZoomToImagePosn(nx, ny);
            ev.preventDefault();
            return true;
        }
        return false;
    }

    function onToolAttach(m) {
        setMode(m);
        if (enabled) {
            if (cursor == null) {
                _initCursor();
            }
            _drawCursor();
        }
    }

    function onToolRemove() {
        if (penDown) {
            _endStroke();
        }
        penDown = false;
        wpd.graphicsWidget.resetHover();
    }

    return {
        isEnabled: isEnabled,
        toggle: toggle,
        handleKeyDown: handleKeyDown,
        onToolAttach: onToolAttach,
        onToolRemove: onToolRemove,
        redrawCursor: _drawCursor
    };
})();

wpd.BoxMaskTool = class {
    constructor() {
        this.isDrawing = false;
        this.topImageCorner = null;
        this.topScreenCorner = null;
        this.moveTimer = null;
        this.screenPos = null;
        this.canvasPos = null;
        this.mouseOutPos = null;
        this.mouseOutImagePos = null;
    }

    mouseMoveHandler() {
        if (this.isDrawing === false) {
            return;
        }
        let ctx = wpd.graphicsWidget.getAllContexts();
        wpd.graphicsWidget.resetHover();
        ctx.hoverCtx.strokeStyle = "rgb(0,0,0)";
        ctx.hoverCtx.strokeRect(this.topScreenCorner.x, this.topScreenCorner.y,
            this.canvasPos.x - this.topScreenCorner.x,
            this.canvasPos.y - this.topScreenCorner.y);
    }

    mouseUpHandler(ev, pos, imagePos) {
        if (this.isDrawing === false) {
            return;
        }
        clearTimeout(this.moveTimer);
        let ctx = wpd.graphicsWidget.getAllContexts();
        this.isDrawing = false;
        wpd.graphicsWidget.resetHover();
        ctx.dataCtx.globalCompositeOperation = "xor";
        ctx.oriDataCtx.globalCompositeOperation = "xor";
        ctx.dataCtx.fillStyle = "rgba(255,255,0,0.5)";
        let canvasPos = wpd.graphicsWidget.imageToCanvasPx(imagePos.x, imagePos.y);
        ctx.dataCtx.fillRect(this.topScreenCorner.x, this.topScreenCorner.y,
            canvasPos.x - this.topScreenCorner.x, canvasPos.y - this.topScreenCorner.y);
        ctx.oriDataCtx.fillStyle = "rgba(255,255,0,0.5)";
        ctx.oriDataCtx.fillRect(this.topImageCorner.x, this.topImageCorner.y,
            imagePos.x - this.topImageCorner.x,
            imagePos.y - this.topImageCorner.y);
    }

    onAttach() {
        wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
        document.getElementById('box-mask').classList.add('pressed-button');
        document.getElementById('view-mask').classList.add('pressed-button');
        // OpenDigitizer: show the box container (holds the Polygon checkbox)
        const cont = document.getElementById('mask-box-container');
        if (cont) cont.style.display = 'block';
    }

    onMouseDown(ev, pos, imagePos) {
        if (this.isDrawing === true)
            return;
        this.isDrawing = true;
        this.topImageCorner = imagePos;
        this.topScreenCorner = wpd.graphicsWidget.imageToCanvasPx(imagePos.x, imagePos.y);
    }

    onMouseMove(ev, pos, imagePos) {
        if (this.isDrawing === false)
            return;
        this.canvasPos = wpd.graphicsWidget.imageToCanvasPx(imagePos.x, imagePos.y);
        this.mouseMoveHandler();
    };

    onMouseOut(ev, pos, imagePos) {
        if (this.isDrawing === true) {
            clearTimeout(this.moveTimer);
            this.mouseOutPos = pos;
            this.mouseOutImagePos = imagePos;
        }
    };

    onDocumentMouseUp(ev, pos, imagePos) {
        if (this.mouseOutPos != null && this.mouseOutImagePos != null) {
            this.mouseUpHandler(ev, this.mouseOutPos, this.mouseOutImagePos);
        } else {
            this.mouseUpHandler(ev, pos, imagePos);
        }
        this.mouseOutPos = null;
        this.mouseOutImagePos = null;
    };

    onMouseUp(ev, pos, imagePos) {
        this.mouseUpHandler(ev, pos, imagePos);
    };

    onRemove() {
        document.getElementById('box-mask').classList.remove('pressed-button');
        document.getElementById('view-mask').classList.remove('pressed-button');
        const cont = document.getElementById('mask-box-container');
        if (cont) cont.style.display = 'none';
        wpd.dataMask.grabMask();
    };

};

wpd.PenMaskTool = (function() {
    var Tool = function() {
        var strokeWidth, ctx = wpd.graphicsWidget.getAllContexts(),
            isDrawing = false,
            moveTimer,
            screen_pos, canvas_pos, image_pos, mouseMoveHandler = function() {
                ctx.dataCtx.globalCompositeOperation = "xor";
                ctx.oriDataCtx.globalCompositeOperation = "xor";
                ctx.dataCtx.strokeStyle = "rgba(255,255,0,0.5)";
                ctx.dataCtx.lineTo(canvas_pos.x, canvas_pos.y);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,0.5)";
                ctx.oriDataCtx.lineTo(image_pos.x, image_pos.y);
                ctx.oriDataCtx.stroke();
                ctx.dataCtx.globalCompositeOperation = "source-over";
                ctx.oriDataCtx.globalCompositeOperation = "source-over";
            };

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('pen-mask').classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
            document.getElementById('mask-paint-container').style.display = 'block';
            // OpenDigitizer: enable keyboard masking (X) for this tool
            wpd.graphicsWidget.setCanvasFocus(true);
            wpd.maskKeyboard.onToolAttach('pen');
        };

        this.onKeyDown = function(ev) {
            wpd.maskKeyboard.handleKeyDown(ev);
        };

        this.onRedraw = function() {
            if (wpd.maskKeyboard.isEnabled()) {
                wpd.maskKeyboard.redrawCursor();
            }
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            // OpenDigitizer: keyboard masking takes over — ignore the mouse
            if (wpd.maskKeyboard.isEnabled())
                return;
            if (isDrawing === true)
                return;
            let lwidth = wpd.getMaskWidth('pen');
            let canvasPos = wpd.graphicsWidget.screenToCanvasPx(pos.x, pos.y);
            isDrawing = true;
            ctx.dataCtx.globalCompositeOperation = "xor";
            ctx.oriDataCtx.globalCompositeOperation = "xor";
            ctx.dataCtx.strokeStyle = "rgba(255,255,0,0.5)";
            ctx.dataCtx.lineWidth = lwidth * wpd.graphicsWidget.getZoomRatio();
            ctx.dataCtx.beginPath();
            ctx.dataCtx.moveTo(canvasPos.x, canvasPos.y);

            ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,0.5)";
            ctx.oriDataCtx.lineWidth = lwidth;
            ctx.oriDataCtx.beginPath();
            ctx.oriDataCtx.moveTo(imagePos.x, imagePos.y);
            ctx.dataCtx.globalCompositeOperation = "source-over";
            ctx.oriDataCtx.globalCompositeOperation = "source-over";
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            canvas_pos = wpd.graphicsWidget.screenToCanvasPx(pos.x, pos.y);
            image_pos = imagePos;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            clearTimeout(moveTimer);
            ctx.dataCtx.closePath();
            ctx.dataCtx.lineWidth = 1;
            ctx.oriDataCtx.closePath();
            ctx.oriDataCtx.lineWidth = 1;
            isDrawing = false;
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            this.onMouseUp(ev, pos, imagePos);
        };

        this.onRemove = function() {
            document.getElementById('pen-mask').classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            document.getElementById('mask-paint-container').style.display = 'none';
            wpd.maskKeyboard.onToolRemove();
            wpd.dataMask.grabMask();
            wpd.toolbar.clear();
        };
    };
    return Tool;
})();

wpd.EraseMaskTool = (function() {
    var Tool = function() {
        var strokeWidth, ctx = wpd.graphicsWidget.getAllContexts(),
            isDrawing = false,
            moveTimer,
            screen_pos, canvas_pos, image_pos, mouseMoveHandler = function() {
                ctx.dataCtx.globalCompositeOperation = "destination-out";
                ctx.oriDataCtx.globalCompositeOperation = "destination-out";

                ctx.dataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.dataCtx.lineTo(canvas_pos.x, canvas_pos.y);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.oriDataCtx.lineTo(image_pos.x, image_pos.y);
                ctx.oriDataCtx.stroke();
                ctx.dataCtx.globalCompositeOperation = "source-over";
                ctx.oriDataCtx.globalCompositeOperation = "source-over";
            };

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('erase-mask').classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
            document.getElementById('mask-erase-container').style.display = 'block';
            // OpenDigitizer: enable keyboard masking (X) for this tool
            wpd.graphicsWidget.setCanvasFocus(true);
            wpd.maskKeyboard.onToolAttach('erase');
        };

        this.onKeyDown = function(ev) {
            wpd.maskKeyboard.handleKeyDown(ev);
        };

        this.onRedraw = function() {
            if (wpd.maskKeyboard.isEnabled()) {
                wpd.maskKeyboard.redrawCursor();
            }
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            // OpenDigitizer: keyboard masking takes over — ignore the mouse
            if (wpd.maskKeyboard.isEnabled())
                return;
            if (isDrawing === true)
                return;
            let lwidth = wpd.getMaskWidth('erase');
            let canvasPos = wpd.graphicsWidget.screenToCanvasPx(pos.x, pos.y);
            isDrawing = true;
            ctx.dataCtx.globalCompositeOperation = "destination-out";
            ctx.oriDataCtx.globalCompositeOperation = "destination-out";

            ctx.dataCtx.strokeStyle = "rgba(0,0,0,1)";
            ctx.dataCtx.lineWidth = lwidth * wpd.graphicsWidget.getZoomRatio();
            ctx.dataCtx.beginPath();
            ctx.dataCtx.moveTo(canvasPos.x, canvasPos.y);

            ctx.oriDataCtx.strokeStyle = "rgba(0,0,0,1)";
            ctx.oriDataCtx.lineWidth = lwidth;
            ctx.oriDataCtx.beginPath();
            ctx.oriDataCtx.moveTo(imagePos.x, imagePos.y);
            ctx.dataCtx.globalCompositeOperation = "source-over";
            ctx.oriDataCtx.globalCompositeOperation = "source-over";
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            image_pos = imagePos;
            canvas_pos = wpd.graphicsWidget.screenToCanvasPx(pos.x, pos.y);
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            this.onMouseUp(ev, pos, imagePos);
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            clearTimeout(moveTimer);
            ctx.dataCtx.closePath();
            ctx.dataCtx.lineWidth = 1;
            ctx.oriDataCtx.closePath();
            ctx.oriDataCtx.lineWidth = 1;

            ctx.dataCtx.globalCompositeOperation = "source-over";
            ctx.oriDataCtx.globalCompositeOperation = "source-over";

            isDrawing = false;
        };

        this.onRemove = function() {
            document.getElementById('erase-mask').classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            document.getElementById('mask-erase-container').style.display = 'none';
            wpd.maskKeyboard.onToolRemove();
            wpd.dataMask.grabMask();
            wpd.toolbar.clear();
        };
    };
    return Tool;
})();

// OpenDigitizer: click-to-click mask tool, shared by:
//   - Box  + "Polygon" checkbox  -> fill mode  (closed filled polygon region)
//   - Pen  + "Polyline" checkbox -> stroke mode (connected brush-width lines)
// Click to drop vertices; Enter commits, Esc cancels, Backspace/Delete undoes
// the last vertex.
wpd.PolygonMaskTool = (function() {
    var Tool = function(opts) {
        opts = opts || {};
        const fillMode = opts.fill !== false; // true = polygon fill, false = polyline stroke
        const buttonId = opts.buttonId || 'box-mask';
        const containerId = opts.containerId || 'mask-box-container';
        let vertices = []; // image px {x, y}
        let cursor = null; // image px, for the rubber-band preview

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById(buttonId).classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
            const cont = document.getElementById(containerId);
            if (cont) cont.style.display = 'block';
            wpd.graphicsWidget.setCanvasFocus(true);
            vertices = [];
            cursor = null;
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            vertices.push({
                x: imagePos.x,
                y: imagePos.y
            });
            _drawPreview();
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            cursor = {
                x: imagePos.x,
                y: imagePos.y
            };
            if (vertices.length > 0) {
                _drawPreview();
            }
        };

        this.onKeyDown = function(ev) {
            if (wpd.keyCodes.isEnter(ev.keyCode)) {
                _commit(); // fill or stroke depending on mode
                ev.preventDefault();
            } else if (wpd.keyCodes.isEsc(ev.keyCode)) {
                // cancel without committing
                vertices = [];
                cursor = null;
                wpd.graphicsWidget.resetHover();
                ev.preventDefault();
            } else if (wpd.keyCodes.isBackspace(ev.keyCode) || wpd.keyCodes.isDel(ev.keyCode)) {
                vertices.pop();
                _drawPreview();
                ev.preventDefault();
            }
        };

        this.onRemove = function() {
            document.getElementById(buttonId).classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            const cont = document.getElementById(containerId);
            if (cont) cont.style.display = 'none';
            wpd.graphicsWidget.resetHover();
            wpd.dataMask.grabMask();
            wpd.toolbar.clear();
        };

        function _drawPreview() {
            wpd.graphicsWidget.resetHover();
            if (vertices.length === 0) {
                return;
            }
            const ctx = wpd.graphicsWidget.getAllContexts().hoverCtx;
            ctx.save();
            ctx.strokeStyle = 'rgba(20,120,255,0.95)';
            ctx.fillStyle = 'rgba(20,120,255,0.95)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const p0 = wpd.graphicsWidget.imageToCanvasPx(vertices[0].x, vertices[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < vertices.length; i++) {
                const p = wpd.graphicsWidget.imageToCanvasPx(vertices[i].x, vertices[i].y);
                ctx.lineTo(p.x, p.y);
            }
            if (cursor) {
                const c = wpd.graphicsWidget.imageToCanvasPx(cursor.x, cursor.y);
                ctx.lineTo(c.x, c.y);
            }
            // in fill mode, preview the closing edge back to the first vertex
            if (fillMode && vertices.length >= 2) {
                ctx.lineTo(p0.x, p0.y);
            }
            ctx.stroke();
            for (let i = 0; i < vertices.length; i++) {
                const p = wpd.graphicsWidget.imageToCanvasPx(vertices[i].x, vertices[i].y);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
                ctx.fill();
            }
            ctx.restore();
        }

        function _commit() {
            if (vertices.length < 2) {
                vertices = [];
                cursor = null;
                wpd.graphicsWidget.resetHover();
                return;
            }
            // fill only makes sense with 3+ vertices; otherwise fall back to a stroke
            const doFill = fillMode && vertices.length >= 3;
            const ctx = wpd.graphicsWidget.getAllContexts();
            const w = wpd.getMaskWidth('pen');
            const zoom = wpd.graphicsWidget.getZoomRatio();

            const drawOn = (c, toCanvas) => {
                c.save();
                c.globalCompositeOperation = 'xor';
                c.strokeStyle = 'rgba(255,255,0,0.5)';
                c.fillStyle = 'rgba(255,255,0,0.5)';
                c.lineWidth = toCanvas ? (w * zoom) : w;
                c.lineCap = 'round';
                c.lineJoin = 'round';
                c.beginPath();
                const conv = (v) => toCanvas ? wpd.graphicsWidget.imageToCanvasPx(v.x, v.y) : {
                    x: v.x,
                    y: v.y
                };
                const s0 = conv(vertices[0]);
                c.moveTo(s0.x, s0.y);
                for (let i = 1; i < vertices.length; i++) {
                    const s = conv(vertices[i]);
                    c.lineTo(s.x, s.y);
                }
                if (doFill) {
                    c.closePath();
                    c.fill();
                } else {
                    c.stroke();
                }
                c.restore();
            };
            drawOn(ctx.dataCtx, true);
            drawOn(ctx.oriDataCtx, false);

            wpd.dataMask.grabMask();
            vertices = [];
            cursor = null;
            wpd.graphicsWidget.resetHover();
        }
    };
    return Tool;
})();

wpd.ViewMaskTool = (function() {
    var Tool = function() {
        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('view-mask').classList.add('pressed-button');
        };

        this.onRemove = function() {
            document.getElementById('view-mask').classList.remove('pressed-button');
            wpd.dataMask.grabMask();
        };
    };

    return Tool;
})();

wpd.MaskPainter = (function() {
    var Painter = function() {
        let ctx = wpd.graphicsWidget.getAllContexts();
        let ds = wpd.tree.getActiveDataset();
        let autoDetector = wpd.appData.getPlotData().getAutoDetectionDataForDataset(ds);

        let painter = function() {
            if (autoDetector.mask == null || autoDetector.mask.size === 0) {
                return;
            }
            let imageSize = wpd.graphicsWidget.getImageSize();
            let imgData = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);

            for (let img_index of autoDetector.mask) {
                imgData.data[img_index * 4] = 255;
                imgData.data[img_index * 4 + 1] = 255;
                imgData.data[img_index * 4 + 2] = 0;
                imgData.data[img_index * 4 + 3] = 255 / 2;
            }

            ctx.oriDataCtx.putImageData(imgData, 0, 0);
            wpd.graphicsWidget.copyImageDataLayerToScreen();
        };

        this.preventGrab = false;

        this.painterName = 'dataMaskPainter';

        this.onRedraw = function() {
            if (!this.preventGrab) {
                wpd.dataMask.grabMask();
            }
            painter();
        };

        this.onAttach = function() {
            this.preventGrab = true;
            wpd.graphicsWidget.resetData();
            this.preventGrab = false;
        };
    };
    return Painter;
})();
