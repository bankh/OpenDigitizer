/*
    OpenDigitizer - open fork of WebPlotDigitizer

    Copyright (C) 2025 Ankit Rohatgi (original WebPlotDigitizer)
    Copyright (C) 2026 OpenDigitizer contributors (this file)

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

// OpenDigitizer: folder/thumbnail image browser.
//
// Lets the user pick a whole folder of images, loads them all into the existing
// multi-file FileManager, and presents a thumbnail strip for fast switching.
// Hovering a thumbnail shows a large floating preview. The widget builds its own
// DOM and styles on first use, so it works in both the dev and built pages
// without extra template wiring beyond a single "Open Folder" trigger.
wpd.imageBrowser = (function() {
    let _built = false;
    let _objectUrls = []; // track for revocation to avoid leaks
    let _files = [];
    let _$panel, _$strip, _$preview, _$previewImg, _$count, _$folderInput;

    const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tif?f|svg)$/i;

    function _isImage(file) {
        if (file.type && file.type.match("image.*")) {
            return true;
        }
        // some browsers leave .type empty for directory picks; fall back to ext
        return IMAGE_EXT.test(file.name || "");
    }

    function _injectStyles() {
        if (document.getElementById('od-image-browser-styles')) {
            return;
        }
        const css = `
        #od-image-browser {
            position: fixed; left: 0; right: 0; bottom: 0; height: 116px;
            background: #2b2b2b; border-top: 1px solid #555; z-index: 600;
            display: none; box-shadow: 0 -2px 8px rgba(0,0,0,0.4);
            font-family: sans-serif;
        }
        #od-image-browser.od-open { display: block; }
        #od-image-browser .od-ib-header {
            height: 20px; color: #ddd; font-size: 12px; padding: 2px 8px;
            display: flex; justify-content: space-between; align-items: center;
        }
        #od-image-browser .od-ib-close {
            cursor: pointer; color: #ddd; background: none; border: none; font-size: 14px;
        }
        #od-image-browser .od-ib-strip {
            height: 92px; overflow-x: auto; overflow-y: hidden; white-space: nowrap;
            padding: 2px 6px;
        }
        #od-image-browser .od-ib-thumb {
            display: inline-block; width: 84px; height: 84px; margin: 0 4px;
            border: 2px solid transparent; border-radius: 3px; cursor: pointer;
            background: #1c1c1c; vertical-align: top; position: relative; overflow: hidden;
        }
        #od-image-browser .od-ib-thumb img {
            width: 100%; height: 64px; object-fit: contain; display: block;
        }
        #od-image-browser .od-ib-thumb .od-ib-name {
            color: #bbb; font-size: 10px; text-align: center; line-height: 16px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px;
        }
        #od-image-browser .od-ib-thumb.od-active {
            border-color: #4caf50;
        }
        #od-image-browser .od-ib-thumb.od-active .od-ib-name { color: #8f8; }
        #od-image-browser-preview {
            position: fixed; z-index: 700; display: none; pointer-events: none;
            border: 2px solid #4caf50; background: #fff; border-radius: 4px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5); padding: 2px;
        }
        #od-image-browser-preview img {
            max-width: 460px; max-height: 460px; display: block;
        }`;
        const $style = document.createElement('style');
        $style.id = 'od-image-browser-styles';
        $style.textContent = css;
        document.head.appendChild($style);
    }

    function _build() {
        if (_built) {
            return;
        }
        _injectStyles();

        // hidden folder input
        _$folderInput = document.createElement('input');
        _$folderInput.type = 'file';
        _$folderInput.id = 'od-folder-input';
        _$folderInput.multiple = true;
        // webkitdirectory enables folder selection across Chromium/Firefox/Safari
        _$folderInput.setAttribute('webkitdirectory', '');
        _$folderInput.setAttribute('directory', '');
        _$folderInput.style.display = 'none';
        _$folderInput.addEventListener('change', _onFolderPicked, false);
        document.body.appendChild(_$folderInput);

        // panel
        _$panel = document.createElement('div');
        _$panel.id = 'od-image-browser';

        const $header = document.createElement('div');
        $header.className = 'od-ib-header';
        const $title = document.createElement('span');
        $title.id = 'od-ib-title';
        _$count = document.createElement('span');
        _$count.id = 'od-ib-count';
        $title.appendChild(document.createTextNode(wpd.gettext ? wpd.gettext('image-browser') || 'Images' : 'Images'));
        $title.appendChild(document.createTextNode(' '));
        $title.appendChild(_$count);
        const $close = document.createElement('button');
        $close.className = 'od-ib-close';
        $close.title = 'Close';
        $close.textContent = '✕';
        $close.addEventListener('click', hide, false);
        $header.appendChild($title);
        $header.appendChild($close);

        _$strip = document.createElement('div');
        _$strip.className = 'od-ib-strip';

        _$panel.appendChild($header);
        _$panel.appendChild(_$strip);
        document.body.appendChild(_$panel);

        // floating large preview
        _$preview = document.createElement('div');
        _$preview.id = 'od-image-browser-preview';
        _$previewImg = document.createElement('img');
        _$preview.appendChild(_$previewImg);
        document.body.appendChild(_$preview);

        _built = true;
    }

    // open the OS folder picker
    function openFolder() {
        _build();
        _$folderInput.value = null; // allow re-selecting the same folder
        _$folderInput.click();
    }

    function _onFolderPicked(ev) {
        const picked = Array.prototype.slice.call(ev.target.files || []);
        const images = picked.filter(_isImage);

        if (images.length === 0) {
            wpd.messagePopup.show(
                wpd.gettext ? (wpd.gettext('no-images-found') || 'No images found') : 'No images found',
                'No image files were found in the selected folder.');
            return;
        }

        // natural-ish sort by file name so pages/series stay in order
        images.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, {
            numeric: true,
            sensitivity: 'base'
        }));

        wpd.popup.close('loadNewImage');
        _files = images;
        wpd.imageManager.loadFiles(images);
        _buildThumbnails();
        show();
    }

    function _revokeUrls() {
        _objectUrls.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {}
        });
        _objectUrls = [];
    }

    function _buildThumbnails() {
        _build();
        _revokeUrls();
        _$strip.innerHTML = '';

        _files.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            _objectUrls.push(url);

            const $thumb = document.createElement('div');
            $thumb.className = 'od-ib-thumb';
            $thumb.dataset.index = index;

            const $img = document.createElement('img');
            $img.src = url;
            $img.loading = 'lazy';
            $img.alt = file.name;

            const $name = document.createElement('div');
            $name.className = 'od-ib-name';
            $name.textContent = file.name;
            $name.title = file.name;

            $thumb.appendChild($img);
            $thumb.appendChild($name);

            $thumb.addEventListener('click', () => _selectIndex(index), false);
            $thumb.addEventListener('mouseenter', (e) => _showPreview(url, $thumb), false);
            $thumb.addEventListener('mousemove', (e) => _positionPreview(e), false);
            $thumb.addEventListener('mouseleave', _hidePreview, false);

            _$strip.appendChild($thumb);
        });

        _updateCount();
        refresh();
    }

    function _updateCount() {
        if (_$count) {
            _$count.textContent = '(' + _files.length + ')';
        }
    }

    function _selectIndex(index) {
        const fileManager = wpd.appData.getFileManager();
        fileManager.switch(index);

        // keep the existing file-select dropdown in sync
        const $sel = document.getElementById('image-file-select');
        if ($sel) {
            $sel.value = index;
        }
        refresh();
    }

    // highlight the thumbnail matching the FileManager's current file
    function refresh() {
        if (!_built) {
            return;
        }
        const current = wpd.appData.getFileManager().currentFileIndex();
        const thumbs = _$strip.querySelectorAll('.od-ib-thumb');
        thumbs.forEach($t => {
            if (parseInt($t.dataset.index, 10) === current) {
                $t.classList.add('od-active');
                // bring active thumb into view
                if ($t.scrollIntoView) {
                    $t.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest'
                    });
                }
            } else {
                $t.classList.remove('od-active');
            }
        });
    }

    function _showPreview(url, $thumb) {
        if (!_$preview) {
            return;
        }
        _$previewImg.src = url;
        _$preview.style.display = 'block';
        const rect = $thumb.getBoundingClientRect();
        _positionPreviewAt(rect.left, rect.top);
    }

    function _positionPreview(ev) {
        _positionPreviewAt(ev.clientX, ev.clientY);
    }

    function _positionPreviewAt(x, y) {
        if (!_$preview || _$preview.style.display === 'none') {
            return;
        }
        // show the preview above the strip, clamped to the viewport
        const pw = _$preview.offsetWidth || 300;
        const ph = _$preview.offsetHeight || 300;
        let left = x;
        if (left + pw > window.innerWidth - 8) {
            left = window.innerWidth - pw - 8;
        }
        if (left < 8) {
            left = 8;
        }
        let top = y - ph - 16; // above the cursor/thumbnail
        if (top < 8) {
            top = 8;
        }
        _$preview.style.left = left + 'px';
        _$preview.style.top = top + 'px';
    }

    function _hidePreview() {
        if (_$preview) {
            _$preview.style.display = 'none';
        }
    }

    function show() {
        _build();
        if (_files.length > 0) {
            _$panel.classList.add('od-open');
        }
    }

    function hide() {
        _hidePreview();
        if (_$panel) {
            _$panel.classList.remove('od-open');
        }
    }

    function toggle() {
        _build();
        if (_$panel.classList.contains('od-open')) {
            hide();
        } else {
            show();
        }
    }

    return {
        openFolder: openFolder,
        show: show,
        hide: hide,
        toggle: toggle,
        refresh: refresh
    };
})();
