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

// OpenDigitizer: generic adapter for an OPEN, self-hosted CV/AI detection
// backend (e.g. a Python FastAPI service running OpenCV / scikit-image /
// PyTorch). It implements the same detector interface as the built-in
// algorithms, but runs asynchronously and delegates the actual detection to an
// HTTP endpoint that you control.
//
// Wire it up (e.g. in a small init script or the browser console):
//
//   wpd.detectorRegistry.register({
//       id: 'myModel',
//       name: 'My Model (remote)',
//       axesTypes: '*',
//       createAlgo: () => new wpd.RemoteDetector({
//           endpoint: 'http://localhost:8000/detect',
//           name: 'My Model'
//       })
//   });
//
// Request body (POST JSON):
//   {
//     image:  "<base64 PNG of the source image>",
//     width:  <int>, height: <int>,
//     mask:   [<pixel index = y*width + x>, ...],   // current foreground mask
//     params: { ...detector params... },
//     axesType: "XYAxes" | "BarAxes" | ...
//   }
//
// Response body (JSON) - coordinates are IMAGE PIXELS:
//   {
//     points: [ { x: <px>, y: <px>, metadata?: {..} }, ... ]
//   }
//
// See docs/EXTENDING-CV-AI.md for the full contract and a reference Python
// server stub.
wpd.RemoteDetector = class {
    constructor(config) {
        config = config || {};
        this._endpoint = config.endpoint || '';
        this._name = config.name || 'Remote Detector';
        this._extraParams = config.params || {};
        this._params = {};
        this._onComplete = null;
        this._wasRun = false;
        // tells wpd.algoManager to treat run() as asynchronous
        this.isAsync = true;
    }

    getParamList(axes) {
        // expose any configured params as editable fields; endpoint is read-only info
        const list = {};
        Object.keys(this._extraParams).forEach(key => {
            const val = (this._params[key] !== undefined) ? this._params[key] : this._extraParams[key];
            list[key] = [key, '', val];
        });
        return list;
    }

    setParams(params) {
        this._params = Object.assign({}, this._extraParams, params);
    }

    getParams() {
        return Object.assign({}, this._extraParams, this._params);
    }

    setOnCompleteCallback(fn) {
        this._onComplete = fn;
    }

    _finish() {
        if (typeof this._onComplete === 'function') {
            this._onComplete();
        }
    }

    serialize() {
        return this._wasRun ? {
            algoType: "RemoteDetector",
            endpoint: this._endpoint,
            params: this.getParams()
        } : null;
    }

    deserialize(obj) {
        this._endpoint = obj.endpoint || this._endpoint;
        this._params = obj.params || {};
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes, imageData) {
        this._wasRun = true;

        if (!this._endpoint) {
            console.error('RemoteDetector: no endpoint configured');
            this._finish();
            return;
        }

        const payload = {
            image: wpd.graphicsWidget.getBase64Image(),
            width: autoDetector.imageWidth,
            height: autoDetector.imageHeight,
            mask: autoDetector.binaryData ? Array.from(autoDetector.binaryData) : [],
            params: this.getParams(),
            axesType: (axes && axes.constructor) ? axes.constructor.name : null
        };

        fetch(this._endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })
            .then(resp => {
                if (!resp.ok) {
                    throw new Error('HTTP ' + resp.status);
                }
                return resp.json();
            })
            .then(result => {
                const points = (result && result.points) ? result.points : [];
                dataSeries.clearAll();
                points.forEach(pt => {
                    if (pt.metadata != null) {
                        dataSeries.addPixel(pt.x, pt.y, pt.metadata);
                    } else {
                        dataSeries.addPixel(pt.x, pt.y);
                    }
                });
                this._finish();
            })
            .catch(err => {
                console.error('RemoteDetector request failed:', err);
                if (wpd.messagePopup) {
                    wpd.messagePopup.show('Remote detector error',
                        'The detection request failed: ' + err.message);
                }
                this._finish();
            });
    }
};
