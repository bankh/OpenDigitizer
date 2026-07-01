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

// OpenDigitizer: EXAMPLE pluggable detector.
//
// A minimal but fully functional curve detector that demonstrates the
// extension seam (wpd.detectorRegistry). For each image column (stepping by
// ΔX), it averages the y-coordinate of the foreground/masked pixels in that
// column and emits one point. It is intentionally simple so it can serve as a
// copy-paste template for real CV/AI detectors.
//
// Interface contract: see docs/EXTENDING-CV-AI.md
wpd.ExampleColumnDetector = class {
    constructor() {
        this._xStep = 10;
        this._wasRun = false;
    }

    getParamList(axes) {
        return {
            xStep: ['ΔX', 'Px', this._xStep]
        };
    }

    setParams(params) {
        this._xStep = parseFloat(params.xStep);
    }

    getParams() {
        return {
            xStep: this._xStep
        };
    }

    serialize() {
        return this._wasRun ? {
            algoType: "ExampleColumnDetector",
            xStep: this._xStep
        } : null;
    }

    deserialize(obj) {
        this._xStep = obj.xStep;
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes, imageData) {
        this._wasRun = true;

        const dw = autoDetector.imageWidth;
        const dh = autoDetector.imageHeight;
        const binaryData = autoDetector.binaryData;

        if (dw <= 0 || dh <= 0 || binaryData == null || binaryData.size === 0) {
            return;
        }

        const step = (this._xStep > 0) ? Math.round(this._xStep) : 1;

        dataSeries.clearAll();

        for (let xi = 0; xi < dw; xi += step) {
            let ySum = 0;
            let yCount = 0;
            for (let yi = 0; yi < dh; yi++) {
                if (binaryData.has(yi * dw + xi)) {
                    ySum += yi;
                    yCount++;
                }
            }
            if (yCount > 0) {
                // +0.5 to land at pixel centers, consistent with built-in detectors
                dataSeries.addPixel(xi + 0.5, ySum / yCount + 0.5);
            }
        }
    }
};

// Self-register with the pluggable detector registry. This is exactly what a
// third-party detector (local JS, WASM, or a remote adapter) would do.
if (wpd.detectorRegistry) {
    wpd.detectorRegistry.register({
        id: 'exampleColumnDetector',
        name: 'Column Average (example)',
        axesTypes: ['XYAxes'],
        createAlgo: () => new wpd.ExampleColumnDetector()
    });
}
