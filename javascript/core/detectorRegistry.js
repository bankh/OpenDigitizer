/*
    OpenDigitizer - open fork of WebPlotDigitizer

    Copyright (C) 2026 OpenDigitizer contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
*/

var wpd = wpd || {};

// OpenDigitizer: pluggable detector registry.
//
// This is the extension seam for new computer-vision / AI extraction backends.
// A "detector" is any object that implements the same small interface the
// built-in algorithms use:
//
//   getParamList(axes)  -> { key: [label, unit, defaultValue], ... }
//   setParams(params)   -> void                 // params keyed by getParamList keys
//   run(autoDetector, dataSeries, axes, imageData) -> void   // sync detectors
//   // OR, for async (e.g. WASM worker / remote HTTP) detectors:
//   isAsync = true
//   setOnCompleteCallback(fn)
//   run(autoDetector, dataSeries, axes, imageData)  // calls fn() when finished
//
// A detector reads the foreground mask from `autoDetector.binaryData`
// (a Set of pixel indices = y * imageWidth + x) and/or the raw `imageData`,
// then writes results with `dataSeries.addPixel(x, y, metadataObj?)` in
// IMAGE-PIXEL coordinates. Calibration (pixel -> data) is handled by the app,
// so detectors never need to know about axis math.
//
// See docs/EXTENDING-CV-AI.md for the full contract and JS / WASM / Python
// integration recipes.
wpd.detectorRegistry = (function() {
    const _byId = {};
    const _order = [];

    // descriptor: {
    //   id:        unique string (used as the <option> value; avoid clashing
    //              with built-ins: averagingWindow, XStep, XStepWithInterpolation,
    //              CustomIndependents, blobDetector, barExtraction, histogram,
    //              templateMatcher)
    //   name:      human-readable label shown in the algorithm dropdown
    //   axesTypes: array of axis class names this detector supports
    //              (e.g. ['XYAxes', 'BarAxes']) or '*' for all
    //   createAlgo: () => detector instance implementing the interface above
    // }
    function register(descriptor) {
        if (!descriptor || !descriptor.id || typeof descriptor.createAlgo !== 'function') {
            console.error('detectorRegistry.register: descriptor needs {id, createAlgo}');
            return;
        }
        if (!_byId[descriptor.id]) {
            _order.push(descriptor.id);
        }
        _byId[descriptor.id] = {
            id: descriptor.id,
            name: descriptor.name || descriptor.id,
            axesTypes: descriptor.axesTypes || '*',
            createAlgo: descriptor.createAlgo
        };
    }

    function unregister(id) {
        delete _byId[id];
        const i = _order.indexOf(id);
        if (i >= 0) {
            _order.splice(i, 1);
        }
    }

    function has(id) {
        return Object.prototype.hasOwnProperty.call(_byId, id);
    }

    function getAll() {
        return _order.map(id => _byId[id]);
    }

    function _supportsAxes(descriptor, axes) {
        if (descriptor.axesTypes === '*' || descriptor.axesTypes == null) {
            return true;
        }
        // match by constructor name to avoid load-order coupling to axis classes
        const axesName = (axes && axes.constructor) ? axes.constructor.name : null;
        return descriptor.axesTypes.indexOf(axesName) >= 0;
    }

    // detectors available for the currently active axes type
    function getForAxes(axes) {
        return getAll().filter(d => _supportsAxes(d, axes));
    }

    // build a tagged algorithm instance; the detectorId tag lets the UI restore
    // the dropdown selection after save/resume
    function createAlgo(id) {
        const d = _byId[id];
        if (!d) {
            return null;
        }
        const algo = d.createAlgo();
        algo.detectorId = id;
        return algo;
    }

    return {
        register: register,
        unregister: unregister,
        has: has,
        getAll: getAll,
        getForAxes: getForAxes,
        createAlgo: createAlgo
    };
})();
