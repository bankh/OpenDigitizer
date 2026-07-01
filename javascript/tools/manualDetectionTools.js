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

wpd.ManualSelectionTool = (function() {
    var Tool = function(axes, dataset) {

        // OpenDigitizer: index of the point currently "grabbed" for keyboard
        // adjustment (S). -1 = free crosshair movement.
        let grabbedIndex = -1;

        // OpenDigitizer: draw the keyboard-mode crosshair on the data layer.
        // Uses the same image->canvas transform as graphicsHelper.drawPoint so
        // it stays aligned with data points under zoom/rotation.
        const drawCrosshair = () => {
            const cur = wpd.acquireData.getKeyboardCursor();
            if (cur == null) {
                return;
            }
            const ctx = wpd.graphicsWidget.getAllContexts();
            const cp = wpd.graphicsWidget.imageToCanvasPx(cur.x, cur.y);
            const dpr = window.devicePixelRatio;
            const r = 8 * dpr;
            ctx.dataCtx.save();
            // red when a point is grabbed for adjustment, green otherwise
            ctx.dataCtx.strokeStyle = grabbedIndex >= 0 ? "rgba(220,20,20,0.98)" : "rgba(0,150,0,0.95)";
            ctx.dataCtx.lineWidth = 1.5 * dpr;
            ctx.dataCtx.beginPath();
            ctx.dataCtx.moveTo(cp.x - r, cp.y);
            ctx.dataCtx.lineTo(cp.x + r, cp.y);
            ctx.dataCtx.moveTo(cp.x, cp.y - r);
            ctx.dataCtx.lineTo(cp.x, cp.y + r);
            ctx.dataCtx.stroke();
            ctx.dataCtx.beginPath();
            ctx.dataCtx.arc(cp.x, cp.y, r * 0.6, 0, 2.0 * Math.PI);
            ctx.dataCtx.stroke();
            ctx.dataCtx.restore();
        };

        // OpenDigitizer: shared add-point routine used by mouse clicks AND
        // keyboard placement. Records an undo snapshot. Returns the new index.
        const addPointAt = (imagePos) => {
            const before = dataset.getDataPointsState();
            const addPixelArgs = [imagePos.x, imagePos.y];
            const hasPointGroups = dataset.hasPointGroups();

            const tupleIndex = wpd.pointGroups.getCurrentTupleIndex();
            const groupIndex = wpd.pointGroups.getCurrentGroupIndex();

            // handle bar axes labels
            let pointLabel = null;
            if (axes.dataPointsHaveLabels) {
                // only add a label if point groups do not exist, or the current
                // group is the primary group (index 0)
                if (!hasPointGroups || groupIndex === 0) {
                    const mkeys = dataset.getMetadataKeys();
                    const labelKey = "label";

                    if (mkeys == null || !mkeys.length) {
                        dataset.setMetadataKeys([labelKey]);
                    } else if (mkeys.indexOf(labelKey) < 0) {
                        dataset.setMetadataKeys([labelKey, ...mkeys]);
                    }

                    let count = dataset.getCount();
                    if (hasPointGroups) {
                        if (tupleIndex === null) {
                            count = dataset.getTupleCount();
                        } else {
                            count = tupleIndex;
                        }
                    }
                    pointLabel = axes.dataPointsLabelPrefix + count;
                    addPixelArgs.push({
                        [labelKey]: pointLabel
                    });
                }
            }

            const index = dataset.addPixel(...addPixelArgs);
            wpd.graphicsHelper.drawPoint(imagePos, dataset.colorRGB.toRGBString(), pointLabel);

            if (hasPointGroups) {
                if (tupleIndex === null && groupIndex === 0) {
                    const newTupleIndex = dataset.addTuple(index);
                    wpd.pointGroups.setCurrentTupleIndex(newTupleIndex);
                } else {
                    dataset.addToTupleAt(tupleIndex, groupIndex, index);
                }
                wpd.pointGroups.nextGroup();
            }

            wpd.dataPointCounter.setCount(dataset.getCount());
            wpd.events.dispatch("wpd.dataset.point.add", {
                axes: axes,
                dataset: dataset,
                index: index
            });

            wpd.acquireData.recordUndoSnapshot(before);
            return index;
        };

        // OpenDigitizer: move the virtual crosshair (rotation-aware).
        const moveCursor = (ev) => {
            const cur = wpd.acquireData.getKeyboardCursor();
            if (cur == null) {
                return false;
            }
            const stepSize = (ev.shiftKey ? 5 : 0.5) / wpd.graphicsWidget.getZoomRatio();
            const currentRotation = wpd.graphicsWidget.getRotation();
            let {
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, cur.x, cur.y);

            if (wpd.keyCodes.isUp(ev.keyCode)) {
                y = y - stepSize;
            } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                y = y + stepSize;
            } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                x = x - stepSize;
            } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                x = x + stepSize;
            } else {
                return false;
            }

            ({
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(currentRotation, 0, x, y));

            // free movement detaches from any specific point index
            wpd.acquireData.setKeyboardCursor(x, y, -1);
            wpd.graphicsWidget.updateZoomToImagePosn(x, y);
            wpd.graphicsWidget.forceHandlerRepaint();
            return true;
        };

        // OpenDigitizer: jump the crosshair to the previous/next data point.
        const snapCursorToPoint = (direction) => {
            const count = dataset.getCount();
            if (count === 0) {
                return;
            }
            const cur = wpd.acquireData.getKeyboardCursor();
            let index = (cur && typeof cur.index === 'number') ? cur.index : -1;

            if (index < 0) {
                index = (direction > 0) ? 0 : count - 1;
            } else {
                index = (index + direction + count) % count;
            }

            const p = dataset.getPixel(index);
            wpd.acquireData.setKeyboardCursor(p.x, p.y, index);
            wpd.graphicsWidget.updateZoomToImagePosn(p.x, p.y);
            wpd.graphicsWidget.forceHandlerRepaint();
        };

        const addAtCursor = () => {
            const cur = wpd.acquireData.getKeyboardCursor();
            if (cur == null) {
                return;
            }
            const index = addPointAt({
                x: cur.x,
                y: cur.y
            });
            wpd.acquireData.setKeyboardCursor(cur.x, cur.y, index);
            wpd.graphicsWidget.updateZoomToImagePosn(cur.x, cur.y);
            wpd.graphicsWidget.forceHandlerRepaint();
        };

        // OpenDigitizer: delete the data point nearest the crosshair (tuple-safe, undoable)
        const deleteAtCursor = () => {
            const cur = wpd.acquireData.getKeyboardCursor();
            if (cur == null) {
                return;
            }
            const idx = dataset.findNearestPixel(cur.x, cur.y);
            if (idx < 0) {
                return;
            }
            const before = dataset.getDataPointsState();
            if (dataset.hasPointGroups()) {
                const ti = dataset.getTupleIndex(idx);
                if (ti > -1) {
                    dataset.removeFromTupleAt(ti, idx);
                }
                dataset.removePixelAtIndex(idx);
                dataset.refreshTuplesAfterPixelRemoval(idx);
                if (ti > -1 && dataset.isTupleEmpty(ti)) {
                    dataset.removeTuple(ti);
                }
            } else {
                dataset.removePixelAtIndex(idx);
            }
            wpd.acquireData.recordUndoSnapshot(before);
            wpd.acquireData.setKeyboardCursor(cur.x, cur.y, -1);
            wpd.dataPointCounter.setCount(dataset.getCount());
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.events.dispatch("wpd.dataset.point.delete", {
                axes: axes,
                dataset: dataset
            });
        };

        // OpenDigitizer: S grabs/releases the nearest point for keyboard adjustment.
        const releaseGrab = () => {
            grabbedIndex = -1;
        };

        const toggleGrab = () => {
            if (grabbedIndex >= 0) {
                releaseGrab();
                wpd.graphicsWidget.forceHandlerRepaint();
                return;
            }
            const cur = wpd.acquireData.getKeyboardCursor();
            if (cur == null) {
                return;
            }
            const idx = dataset.findNearestPixel(cur.x, cur.y);
            if (idx < 0) {
                return;
            }
            grabbedIndex = idx;
            const p = dataset.getPixel(idx);
            wpd.acquireData.setKeyboardCursor(p.x, p.y, idx);
            wpd.graphicsWidget.updateZoomToImagePosn(p.x, p.y);
            wpd.graphicsWidget.forceHandlerRepaint();
        };

        // OpenDigitizer: move the grabbed point with arrow keys (rotation-aware).
        const moveGrabbedPoint = (ev) => {
            if (grabbedIndex < 0 || grabbedIndex >= dataset.getCount()) {
                return false;
            }
            const stepSize = (ev.shiftKey ? 5 : 0.5) / wpd.graphicsWidget.getZoomRatio();
            const p = dataset.getPixel(grabbedIndex);
            const currentRotation = wpd.graphicsWidget.getRotation();
            let {
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, p.x, p.y);

            if (wpd.keyCodes.isUp(ev.keyCode)) {
                y = y - stepSize;
            } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                y = y + stepSize;
            } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                x = x - stepSize;
            } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                x = x + stepSize;
            } else {
                return false;
            }

            ({
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(currentRotation, 0, x, y));

            dataset.setPixelAt(grabbedIndex, x, y);
            wpd.acquireData.setKeyboardCursor(x, y, grabbedIndex);
            wpd.graphicsWidget.updateZoomToImagePosn(x, y);
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            return true;
        };

        this.onAttach = function() {
            document.getElementById('manual-select-button').classList.add('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));

            // show point group controls if set
            if (dataset.hasPointGroups()) {
                wpd.pointGroups.showControls();
                wpd.pointGroups.refreshControls();
            }
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            // OpenDigitizer: in keyboard mode the mouse does not place points
            if (wpd.acquireData.isKeyboardMode()) {
                return;
            }
            const index = addPointAt(imagePos);
            wpd.graphicsWidget.updateZoomOnEvent(ev);

            // keep the keyboard cursor following the last placed point
            wpd.acquireData.setKeyboardCursor(imagePos.x, imagePos.y, index);

            // If shift was held while clicking a labeled point (e.g. bar charts),
            // open the label editor.
            if (axes.dataPointsHaveLabels && ev.shiftKey) {
                wpd.dataPointLabelEditor.show(dataset, dataset.getCount() - 1, this);
            }
        };

        this.onRemove = function() {
            document.getElementById('manual-select-button').classList.remove('pressed-button');

            // hide point group controls if set
            if (dataset.hasPointGroups()) {
                wpd.pointGroups.hideControls();
            }
        };

        // OpenDigitizer: render the keyboard crosshair on every redraw (after
        // the repainter has drawn the data points).
        this.onRedraw = function() {
            if (wpd.acquireData.isKeyboardMode()) {
                drawCrosshair();
            }
        };

        this.onKeyDown = function(ev) {
            // OpenDigitizer: undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y or Shift+Z)
            if (wpd.acquireData.handleUndoRedoKey(ev)) {
                return;
            }

            // OpenDigitizer: toggle keyboard placement mode with K
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'k')) {
                wpd.acquireData.toggleKeyboardMode();
                ev.preventDefault();
                return;
            }

            // OpenDigitizer: keyboard mode — the keyboard is the primary input.
            // Arrows move the crosshair (or the grabbed point); A/D/S act on the
            // target under the crosshair; Z/C navigate between points. Tool-switch
            // keys are intentionally NOT handled here, so nothing kicks you out of
            // keyboard mode. Press K to leave keyboard mode.
            if (wpd.acquireData.isKeyboardMode()) {
                // arrows: move the grabbed point (adjust) or the free crosshair
                if (grabbedIndex >= 0 ? moveGrabbedPoint(ev) : moveCursor(ev)) {
                    ev.preventDefault();
                    return;
                }
                // A: add a point at the crosshair
                if (wpd.keyCodes.isAlphabet(ev.keyCode, 'a')) {
                    releaseGrab();
                    addAtCursor();
                    ev.preventDefault();
                    return;
                }
                // D / Delete / Backspace: delete the point at the crosshair
                if (wpd.keyCodes.isAlphabet(ev.keyCode, 'd') ||
                    wpd.keyCodes.isDel(ev.keyCode) || wpd.keyCodes.isBackspace(ev.keyCode)) {
                    deleteAtCursor();
                    releaseGrab();
                    ev.preventDefault();
                    return;
                }
                // S: grab / release the nearest point for keyboard adjustment
                if (wpd.keyCodes.isAlphabet(ev.keyCode, 's')) {
                    toggleGrab();
                    ev.preventDefault();
                    return;
                }
                // Z / C: navigate to previous / next existing point
                if (wpd.keyCodes.isAlphabet(ev.keyCode, 'z')) {
                    releaseGrab();
                    snapCursorToPoint(-1);
                    ev.preventDefault();
                    return;
                }
                if (wpd.keyCodes.isAlphabet(ev.keyCode, 'c')) {
                    releaseGrab();
                    snapCursorToPoint(1);
                    ev.preventDefault();
                    return;
                }
                // point group navigation
                if (wpd.keyCodes.isComma(ev.keyCode)) {
                    wpd.pointGroups.previousGroup();
                    return;
                }
                if (wpd.keyCodes.isPeriod(ev.keyCode)) {
                    wpd.pointGroups.nextGroup();
                    return;
                }
                // swallow everything else — do NOT switch tools while in keyboard mode
                return;
            }

            // --- default (mouse) mode: arrow keys nudge the last-added point ---
            if (wpd.keyCodes.isComma(ev.keyCode)) {
                wpd.pointGroups.previousGroup();
                return;
            }
            if (wpd.keyCodes.isPeriod(ev.keyCode)) {
                wpd.pointGroups.nextGroup();
                return;
            }
            if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
                return;
            }

            const lastPtIndex = dataset.getCount() - 1;
            if (lastPtIndex < 0) {
                return; // nothing to nudge
            }
            const lastPt = dataset.getPixel(lastPtIndex);
            const stepSize = 0.5 / wpd.graphicsWidget.getZoomRatio();
            const currentRotation = wpd.graphicsWidget.getRotation();
            let {
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, lastPt.x, lastPt.y);

            if (wpd.keyCodes.isUp(ev.keyCode)) {
                y = y - stepSize;
            } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                y = y + stepSize;
            } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                x = x - stepSize;
            } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                x = x + stepSize;
            } else {
                return;
            }

            ({
                x,
                y
            } = wpd.graphicsWidget.getRotatedCoordinates(currentRotation, 0, x, y));

            dataset.setPixelAt(lastPtIndex, x, y);
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomToImagePosn(lastPt.x, lastPt.y);
            ev.preventDefault();
        };
    };
    return Tool;
})();

wpd.DeleteDataPointTool = (function() {
    var Tool = function(axes, dataset) {
        var ctx = wpd.graphicsWidget.getAllContexts();

        this.onAttach = function() {
            document.getElementById('delete-point-button').classList.add('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            // OpenDigitizer: snapshot for undo before any deletion happens
            const before = dataset.getDataPointsState();

            const tupleCallback = (imagePos, index) => {
                let indexes = [];

                const tupleIndex = dataset.getTupleIndex(index);

                if (tupleIndex > -1) {
                    const indexes = dataset.getTuple(tupleIndex);

                    // sort indexes in descending order for removal
                    const indexesDesc = [...indexes].filter(i => i !== null).sort((a, b) => b - a);

                    // remove each data point in tuple
                    indexesDesc.forEach(idx => {
                        dataset.removePixelAtIndex(idx);
                        // update pixel references in tuples
                        dataset.refreshTuplesAfterPixelRemoval(idx);
                    });

                    // remove tuple
                    dataset.removeTuple(tupleIndex);

                    // update current tuple index pointer
                    wpd.pointGroups.previousGroup();
                } else {
                    // if tuple does not exist, just remove the pixel
                    indexes = [dataset.removeNearestPixel(imagePos.x, imagePos.y)];
                }

                finalCallback(indexes);
            };

            const pointCallback = (imagePos) => {
                const index = dataset.removeNearestPixel(imagePos.x, imagePos.y);

                // remove data point index references from tuples
                const tupleIndex = dataset.getTupleIndex(index);

                if (tupleIndex > -1) {
                    dataset.removeFromTupleAt(tupleIndex, index);

                    // update pixel references in tuples
                    dataset.refreshTuplesAfterPixelRemoval(index);

                    // remove tuple if no point index references left in tuple
                    if (dataset.isTupleEmpty(tupleIndex)) {
                        dataset.removeTuple(tupleIndex);
                    }

                    // update current tuple index pointer
                    wpd.pointGroups.previousGroup();
                }

                finalCallback([index]);
            };

            const finalCallback = (indexes) => {
                // OpenDigitizer: record undo (no-op if nothing was actually removed)
                if (indexes.some(i => i >= 0)) {
                    wpd.acquireData.recordUndoSnapshot(before);
                }

                wpd.graphicsWidget.resetData();
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.graphicsWidget.updateZoomOnEvent(ev);
                wpd.dataPointCounter.setCount(dataset.getCount());

                // dispatch point delete event
                indexes.forEach(index => {
                    wpd.events.dispatch("wpd.dataset.point.delete", {
                        axes: axes,
                        dataset: dataset,
                        index: index
                    });
                });
            };

            // handle point tuple deletion
            if (dataset.hasPointGroups()) {
                const index = dataset.findNearestPixel(imagePos.x, imagePos.y);

                if (index > -1) {
                    // display tuple deletion confirmation popup if point groups exist
                    wpd.pointGroups.showDeleteTuplePopup(
                        tupleCallback.bind(this, imagePos, index),
                        pointCallback.bind(this, imagePos)
                    );
                }
            } else {
                pointCallback(imagePos);
            }
        };

        this.onKeyDown = function(ev) {
            // OpenDigitizer: undo/redo
            if (wpd.acquireData.handleUndoRedoKey(ev)) {
                return;
            }
            if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
            }
        };

        this.onRemove = function() {
            document.getElementById('delete-point-button').classList.remove('pressed-button');
        };
    };
    return Tool;
})();

wpd.MultipleDatasetRepainter = class {
    constructor(axesList, datasetList) {
        this.painterName = "multipleDatasetsRepainter";
        this._datasetList = datasetList;
        this._axesList = axesList;

        // TODO: for each dataset, create a separate DataPointsRepainter
        this._datasetRepainters = [];
        for (let [dsIdx, ds] of datasetList.entries()) {
            let dsAxes = axesList[dsIdx];
            this._datasetRepainters.push(new wpd.DataPointsRepainter(dsAxes, ds));
        }
    }

    drawPoints() {
        for (let dsRepainter of this._datasetRepainters) {
            dsRepainter.drawPoints();
        }
    }

    onAttach() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }

    onRedraw() {
        this.drawPoints();
    }

    onForcedRedraw() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }
};

wpd.DataPointsRepainter = class {
    constructor(axes, dataset) {
        this._axes = axes;
        this._dataset = dataset;
        this.painterName = 'dataPointsRepainter';
    }

    drawPoints() {
        let mkeys = this._dataset.getMetadataKeys();
        let hasLabels = false;

        if (this._axes == null) {
            return; // this can happen when removing widgets when a new file is loaded:
        }

        if (this._axes.dataPointsHaveLabels && mkeys != null && mkeys[0] === 'label') {
            hasLabels = true;
        }

        for (let dindex = 0; dindex < this._dataset.getCount(); dindex++) {
            let imagePos = this._dataset.getPixel(dindex);
            let isSelected = this._dataset.getSelectedPixels().indexOf(dindex) >= 0;

            let fillStyle = isSelected ? "rgb(0,200,0)" : this._dataset.colorRGB.toRGBString();

            if (hasLabels) {
                let pointLabel = null;
                if (this._dataset.hasPointGroups()) {
                    // with point groups, bar labels only apply to points in the primary group (i.e. index 0)
                    const tupleIndex = this._dataset.getTupleIndex(dindex);
                    const groupIndex = this._dataset.getPointGroupIndexInTuple(tupleIndex, dindex);
                    if (groupIndex <= 0) {
                        if (imagePos.metadata !== undefined) {
                            pointLabel = imagePos.metadata.label;
                        }
                        const index = tupleIndex > -1 ? tupleIndex : dindex;
                        if (pointLabel == null) {
                            pointLabel = this._axes.dataPointsLabelPrefix + index;
                        }
                    }
                } else {
                    pointLabel = imagePos.metadata.label;
                    if (pointLabel == null) {
                        pointLabel = this._axes.dataPointsLabelPrefix + dindex;
                    }
                }
                wpd.graphicsHelper.drawPoint(imagePos, fillStyle, pointLabel);
            } else {
                wpd.graphicsHelper.drawPoint(imagePos, fillStyle);
            }
        }
    }

    onAttach() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }

    onRedraw() {
        this.drawPoints();
    }

    onForcedRedraw() {
        wpd.graphicsWidget.resetData();
        //this.drawPoints();
    }
};

wpd.AdjustDataPointTool = (function() {
    const Tool = function(axes, dataset) {
        const $button = document.getElementById('manual-adjust-button');
        const $overrideSection = document.getElementById('value-overrides-controls');
        const $overrideButton = document.getElementById('override-data-values');

        // multi-select box
        let isMouseDown = false;
        let isSelecting = false;
        let _drawTimer = null;
        let p1 = null;
        let p2 = null;
        let imageP1 = null;
        let imageP2 = null;

        this.onAttach = function() {
            $button.classList.add('pressed-button');
            $overrideButton.classList.remove('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
            wpd.toolbar.show('adjustDataPointsToolbar');
        };

        this.onRemove = function() {
            dataset.unselectAll();
            wpd.graphicsWidget.forceHandlerRepaint();
            $button.classList.remove('pressed-button');
            wpd.toolbar.clear();

            // hide override section
            $overrideSection.hidden = true;
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            isMouseDown = true;

            // record the first selection rectangle point
            p1 = pos;
            imageP1 = imagePos;

            // OpenDigitizer: keep the current selection when a modifier key is
            // held (Shift/Ctrl/Cmd) so a rectangle drag ADDS to the selection.
            if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
                dataset.unselectAll();
            }
        };

        this.onMouseUp = function(ev, pos) {
            if (isSelecting === true) {
                // reset hover context to remove selection box drawing
                wpd.graphicsWidget.resetHover();

                // select points within the selection rectangle
                dataset.selectPixelsInRectangle(imageP1, imageP2);
                this._onSelect(ev, dataset.getSelectedPixels());

                // clear the draw timer
                clearTimeout(_drawTimer);

                // push these reset statements to the bottom of the events message queue
                setTimeout(function() {
                    isSelecting = false;
                    isMouseDown = false;
                    p1 = null;
                    p2 = null;

                    // reset hover context to remove previous selection box
                    wpd.graphicsWidget.resetHover();
                });
            } else {
                isMouseDown = false;
                p1 = null;
                p2 = null;

                // reset hover context to remove previous selection box
                wpd.graphicsWidget.resetHover();
            }
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isMouseDown === true) {
                isSelecting = true;

                // record the new position as the second selection rectangle point
                p2 = pos;
                imageP2 = imagePos;

                // refresh the selection rectangle every 1 ms
                clearTimeout(_drawTimer);
                _drawTimer = setTimeout(function() {
                    this._drawSelectionBox();
                }.bind(this), 1);
            }
        };

        this._drawSelectionBox = function() {
            // reset hover context to remove previous selection box
            wpd.graphicsWidget.resetHover();

            // fetch the hover context
            const ctx = wpd.graphicsWidget.getAllContexts().hoverCtx;

            // draw a black rectangle
            if (p1 != null && p2 != null) {
                let canvasP1 = wpd.graphicsWidget.screenToCanvasPx(p1.x, p1.y);
                let canvasP2 = wpd.graphicsWidget.screenToCanvasPx(p2.x, p2.y);

                ctx.strokeStyle = 'rgb(0,0,0)';
                ctx.strokeRect(
                    canvasP1.x,
                    canvasP1.y,
                    canvasP2.x - canvasP1.x,
                    canvasP2.y - canvasP1.y
                );
            }
        };

        this._onSelect = function(ev, pixelIndexes) {
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
            this.toggleOverrideSection(pixelIndexes);
            wpd.events.dispatch("wpd.dataset.point.select", {
                axes: axes,
                dataset: dataset,
                indexes: pixelIndexes
            });
        };

        // OpenDigitizer: delete every selected point at once (tuple-safe + undoable).
        this._deleteSelectedPoints = function() {
            const selIndexes = dataset.getSelectedPixels();
            if (selIndexes.length < 1) {
                return;
            }
            const before = dataset.getDataPointsState();
            const hasGroups = dataset.hasPointGroups();

            // delete in descending index order so earlier indexes stay valid
            // through the splices, and refresh tuple references after each removal
            const sorted = [...selIndexes].sort((a, b) => b - a);
            sorted.forEach(function(idx) {
                if (hasGroups) {
                    const ti = dataset.getTupleIndex(idx);
                    if (ti > -1) {
                        dataset.removeFromTupleAt(ti, idx);
                    }
                    dataset.removePixelAtIndex(idx);
                    dataset.refreshTuplesAfterPixelRemoval(idx);
                    if (ti > -1 && dataset.isTupleEmpty(ti)) {
                        dataset.removeTuple(ti);
                    }
                } else {
                    dataset.removePixelAtIndex(idx);
                }
            });

            dataset.unselectAll();
            wpd.acquireData.recordUndoSnapshot(before);
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.dataPointCounter.setCount(dataset.getCount());
            this.toggleOverrideSection([]);
            wpd.events.dispatch("wpd.dataset.point.delete", {
                axes: axes,
                dataset: dataset
            });
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            if (isSelecting === false) {
                const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
                if (additive) {
                    // OpenDigitizer: toggle nearest point in/out of the selection
                    const pixelIndex = dataset.findNearestPixel(imagePos.x, imagePos.y);
                    if (pixelIndex >= 0) {
                        if (dataset.getSelectedPixels().indexOf(pixelIndex) >= 0) {
                            dataset.unselectPixel(pixelIndex);
                        } else {
                            dataset.selectPixel(pixelIndex);
                        }
                    }
                    this._onSelect(ev, dataset.getSelectedPixels());
                } else {
                    dataset.unselectAll();
                    const pixelIndex = dataset.selectNearestPixel(imagePos.x, imagePos.y);
                    this._onSelect(ev, [pixelIndex]);
                }
            }
        };

        this.onKeyDown = function(ev) {
            // OpenDigitizer: undo/redo first
            if (wpd.acquireData.handleUndoRedoKey(ev)) {
                return;
            }

            if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
                return;
            }

            const selIndexes = dataset.getSelectedPixels();

            if (selIndexes.length < 1) {
                return;
            }

            // OpenDigitizer: delete ALL selected points (works for any selection size)
            if (wpd.keyCodes.isDel(ev.keyCode) || wpd.keyCodes.isBackspace(ev.keyCode)) {
                this._deleteSelectedPoints();
                ev.preventDefault();
                ev.stopPropagation();
                return;
            }

            // key strokes that do not need each point processed
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'r')) {
                wpd.dataPointValueOverrideEditor.show(dataset, axes, selIndexes, this);
                return;
            }

            // key strokes that need each point processed
            let lastPtCoord = {
                x: null,
                y: null
            };
            selIndexes.forEach(function(selIndex) {
                const stepSize = ev.shiftKey === true ? 5 / wpd.graphicsWidget.getZoomRatio() :
                    0.5 / wpd.graphicsWidget.getZoomRatio();

                let selPoint = dataset.getPixel(selIndex),
                    pointPx = selPoint.x,
                    pointPy = selPoint.y;

                // rotate to current rotation
                const currentRotation = wpd.graphicsWidget.getRotation();
                let {
                    x,
                    y
                } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, pointPx, pointPy);

                if (wpd.keyCodes.isUp(ev.keyCode)) {
                    y = y - stepSize;
                } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                    y = y + stepSize;
                } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                    x = x - stepSize;
                } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                    x = x + stepSize;
                } else if (selIndexes.length === 1) {
                    // single selected point operations
                    if (wpd.keyCodes.isAlphabet(ev.keyCode, 'q')) {
                        dataset.selectPreviousPixel();
                        selIndex = dataset.getSelectedPixels()[0];
                        selPoint = dataset.getPixel(selIndex);
                        pointPx = selPoint.x;
                        pointPy = selPoint.y;
                        ({
                            x,
                            y
                        } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, pointPx, pointPy));
                    } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'w')) {
                        dataset.selectNextPixel();
                        selIndex = dataset.getSelectedPixels()[0];
                        selPoint = dataset.getPixel(selIndex);
                        pointPx = selPoint.x;
                        pointPy = selPoint.y;
                        ({
                            x,
                            y
                        } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, pointPx, pointPy));
                    } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'e')) {
                        if (axes.dataPointsHaveLabels) {
                            selIndex = dataset.getSelectedPixels()[0];
                            ev.preventDefault();
                            ev.stopPropagation();
                            wpd.dataPointLabelEditor.show(dataset, selIndex, this);
                            return;
                        }
                    } else if (wpd.keyCodes.isDel(ev.keyCode) || wpd.keyCodes.isBackspace(ev.keyCode)) {
                        dataset.removePixelAtIndex(selIndex);
                        dataset.unselectAll();
                        if (dataset.findNearestPixel(pointPx, pointPy) >= 0) {
                            dataset.selectNearestPixel(pointPx, pointPy);
                            selIndex = dataset.getSelectedPixels()[0];
                            selPoint = dataset.getPixel(selIndex);
                            pointPx = selPoint.x;
                            pointPy = selPoint.y;
                            ({
                                x,
                                y
                            } = wpd.graphicsWidget.getRotatedCoordinates(0, currentRotation, pointPx, pointPy));
                        }
                        wpd.graphicsWidget.resetData();
                        wpd.graphicsWidget.forceHandlerRepaint();
                        wpd.graphicsWidget.updateZoomToImagePosn(pointPx, pointPy);
                        wpd.dataPointCounter.setCount(dataset.getCount());
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    } else {
                        return;
                    }
                } else {
                    return;
                }

                // rotate back to original rotation
                ({
                    x,
                    y
                } = wpd.graphicsWidget.getRotatedCoordinates(currentRotation, 0, x, y));
                dataset.setPixelAt(selIndex, x, y);
                lastPtCoord = {
                    x: x,
                    y: y
                };
            }.bind(this));

            wpd.graphicsWidget.forceHandlerRepaint();
            if (lastPtCoord.x != null) {
                wpd.graphicsWidget.updateZoomToImagePosn(lastPtCoord.x, lastPtCoord.y);
            }
            ev.preventDefault();
            ev.stopPropagation();
        };

        this.toggleOverrideSection = function(pixelIndexes) {
            // Bar charts currently not supported
            const $overriddenIndicator = document.getElementById('overridden-data-indicator');

            // always start with overridden value indicator hidden
            $overriddenIndicator.hidden = true;

            if (
                // single pixel selection:
                // if selectNearestPixel does not find a pixel within the threshold
                // it returns -1
                (
                    pixelIndexes.length === 1 &&
                    pixelIndexes[0] >= 0
                ) ||
                pixelIndexes.length > 1
            ) {
                // display override section
                $overrideSection.hidden = false;

                // attach click handler for value edit popup
                $overrideButton.onclick = wpd.dataPointValueOverrideEditor.show.bind(
                    null,
                    dataset,
                    axes,
                    pixelIndexes,
                    this
                );

                // display overridden value indicator if at least one point has
                // one override value (unless the key is label)
                dataset.getSelectedPixels().some(index => {
                    const pixel = dataset.getPixel(index);
                    if (pixel.metadata) {
                        let threshold = 1;
                        if (pixel.metadata.hasOwnProperty('label')) {
                            threshold += 1;
                        }
                        if (Object.keys(pixel.metadata).length >= threshold) {
                            $overriddenIndicator.hidden = false;
                            return true;
                        }
                    }
                    return false;
                });
            } else {
                // no point(s) selected
                $overrideSection.hidden = true;

                // hide button and clear onclick handler
                $overrideButton.onclick = null;
            }
        };

        this.displayMask = function() {
            // create a mask that makes this tool appear to still be selected
            // when the override popup is engaged
            $button.classList.add('pressed-button');
            wpd.toolbar.show('adjustDataPointsToolbar');
            $overrideSection.hidden = false;
            $overrideButton.classList.add('pressed-button');
        };
    };
    return Tool;
})();

wpd.EditLabelsTool = function(axes, dataset) {
    this.onAttach = function() {
        document.getElementById('edit-data-labels').classList.add('pressed-button');
        wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
    };

    this.onRemove = function() {
        document.getElementById('edit-data-labels').classList.remove('pressed-button');
        dataset.unselectAll();
    };

    this.onMouseClick = function(ev, pos, imagePos) {
        var dataSeries = dataset,
            pixelIndex;
        dataSeries.unselectAll();
        pixelIndex = dataSeries.selectNearestPixel(imagePos.x, imagePos.y);
        if (
            pixelIndex >= 0 &&
            (
                // if point groups exist, check that point is either not in a group
                // or in the primary group
                !dataSeries.hasPointGroups() || dataSeries.getPointGroupIndexInTuple(
                    dataSeries.getTupleIndex(pixelIndex),
                    pixelIndex
                ) <= 0
            )
        ) {
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
            wpd.dataPointLabelEditor.show(dataSeries, pixelIndex, this);
        }
    };

    this.onKeyDown = function(ev) {
        if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
            wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
        }
    };
};

wpd.dataPointCounter = {
    setCount: function(count) {
        let $counters = document.getElementsByClassName('data-point-counter');
        for (let ci = 0; ci < $counters.length; ci++) {
            $counters[ci].innerHTML = count;
        }
    }
};
