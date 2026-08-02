import { DB } from './Storage.js';



const INDEX_KEY = 'VINLAND_ATTACHMENTS_INDEX';
const MAX_THUMBNAIL_SIZE = 200; // px for thumbnail in browser
var objectUrls = {};  // attachmentId -> object URL (for cleanup)

export const AttachmentsManager = {
    _initialized: false,

    init: function() {
        if (this._initialized) return;
        this._initialized = true;

        // Clean up object URLs on page unload
        window.addEventListener('beforeunload', function() {
            for (var id in objectUrls) {
                if (objectUrls.hasOwnProperty(id)) {
                    URL.revokeObjectURL(objectUrls[id]);
                }
            }
        });
    },

    // ─── INDEX HELPERS ───

    _getIndex: function() {
        try {
            var raw = localStorage.getItem(INDEX_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    },

    _saveIndex: function(index) {
        try {
            localStorage.setItem(INDEX_KEY, JSON.stringify(index));
        } catch (e) {
            console.error('[AttachmentsManager] Failed to save index', e);
        }
    },

    // ─── PUBLIC API ───

    
    upload: function(file, extraMeta) {
        var self = this;
        return new Promise(function(resolve, reject) {
            var attachmentId = 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);

            // Create metadata entry
            var meta = {
                id: attachmentId,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size,
                date: Date.now(),
                isImage: file.type && file.type.indexOf('image/') === 0
            };

            // Merge extra metadata
            if (extraMeta && typeof extraMeta === 'object') {
                for (var k in extraMeta) {
                    if (extraMeta.hasOwnProperty(k)) {
                        meta[k] = extraMeta[k];
                    }
                }
            }

            // Read the file as blob and store in IndexedDB
            var reader = new FileReader();
            reader.onload = function(e) {
                var blob;
                if (e.target.result instanceof ArrayBuffer) {
                    blob = new Blob([e.target.result], { type: file.type });
                } else {
                    // dataURL path — convert to blob
                    var dataUrl = e.target.result;
                    var parts = dataUrl.split(',');
                    var byteString = atob(parts[1]);
                    var ab = new ArrayBuffer(byteString.length);
                    var ia = new Uint8Array(ab);
                    for (var i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    blob = new Blob([ab], { type: file.type });
                }

                // Store blob in IndexedDB (attachmentId already has 'att_' prefix)
                DB.save(attachmentId, blob).then(function() {
                    // Add to metadata index
                    var index = self._getIndex();
                    index.push(meta);
                    self._saveIndex(index);

                    // Create object URL for immediate use
                    self._createObjectUrl(attachmentId, blob);
                    resolve(attachmentId);
                }).catch(function(err) {
                    reject(err);
                });
            };

            reader.onerror = function() {
                reject(new Error('FileReader failed'));
            };

            // Read as ArrayBuffer for blob storage (avoids base64 overhead)
            reader.readAsArrayBuffer(file);
        });
    },

    
    getBlob: function(attachmentId) {
        var self = this;
        return new Promise(function(resolve, reject) {
            // Normalize key prefix: attachmentId always starts with 'att_'
            var storeKey = attachmentId.indexOf('att_') === 0 ? attachmentId : 'att_' + attachmentId;

            if (!storeKey || storeKey === 'att_') {
                resolve(null);
                return;
            }

            DB.get(storeKey).then(function(blob) {
                resolve(blob || null);
            }).catch(function(err) {
                reject(err);
            });
        });
    },

    
    getURL: function(attachmentId) {
        var self = this;

        // Return cached URL if available
        if (objectUrls[attachmentId]) {
            return Promise.resolve(objectUrls[attachmentId]);
        }

        return new Promise(function(resolve, reject) {
            self.getBlob(attachmentId).then(function(blob) {
                if (!blob) {
                    resolve(null);
                    return;
                }
                var url = self._createObjectUrl(attachmentId, blob);
                resolve(url);
            }).catch(function(err) {
                reject(err);
            });
        });
    },

    
    getDataURL: function(attachmentId) {
        var self = this;
        return new Promise(function(resolve, reject) {
            self.getBlob(attachmentId).then(function(blob) {
                if (!blob) { resolve(null); return; }
                var reader = new FileReader();
                reader.onload = function(e) { resolve(e.target.result); };
                reader.onerror = function() { reject(new Error('FileReader failed')); };
                reader.readAsDataURL(blob);
            }).catch(function(err) {
                reject(err);
            });
        });
    },

    
    revokeURL: function(attachmentId) {
        if (objectUrls[attachmentId]) {
            URL.revokeObjectURL(objectUrls[attachmentId]);
            delete objectUrls[attachmentId];
        }
    },

    
    list: function() {
        return this._getIndex();
    },

    
    listImages: function() {
        return this._getIndex().filter(function(m) { return m.isImage; });
    },

    
    getMeta: function(attachmentId) {
        var index = this._getIndex();
        for (var i = 0; i < index.length; i++) {
            if (index[i].id === attachmentId) return index[i];
        }
        return null;
    },

    
    delete: function(attachmentId) {
        var self = this;
        return new Promise(function(resolve, reject) {
            var storeKey = attachmentId.indexOf('att_') === 0 ? attachmentId : 'att_' + attachmentId;
            if (!storeKey || storeKey === 'att_') { resolve(); return; }

            // Revoke object URL
            self.revokeURL(attachmentId);

            // Remove from IndexedDB
            DB.delete(storeKey).then(function() {
                // Remove from index
                var index = self._getIndex();
                var found = -1;
                for (var i = 0; i < index.length; i++) {
                    if (index[i].id === attachmentId) {
                        found = i;
                        break;
                    }
                }
                if (found !== -1) {
                    index.splice(found, 1);
                    self._saveIndex(index);
                }
                resolve();
            }).catch(function(err) {
                reject(err);
            });
        });
    },

    
    getTotalSize: function() {
        var index = this._getIndex();
        var total = 0;
        for (var i = 0; i < index.length; i++) {
            total += index[i].size || 0;
        }
        return total;
    },

    // ─── INTERNAL ───

    
    _createObjectUrl: function(attachmentId, blob) {
        // Revoke existing URL if any
        if (objectUrls[attachmentId]) {
            URL.revokeObjectURL(objectUrls[attachmentId]);
        }
        var url = URL.createObjectURL(blob);
        objectUrls[attachmentId] = url;
        return url;
    },

    
    getThumbnailURL: function(attachmentId, maxSize) {
        maxSize = maxSize || MAX_THUMBNAIL_SIZE;
        var self = this;
        var meta = this.getMeta(attachmentId);
        if (!meta || !meta.isImage) {
            return this.getURL(attachmentId);
        }

        return new Promise(function(resolve, reject) {
            self.getBlob(attachmentId).then(function(blob) {
                if (!blob) { resolve(null); return; }

                // If image is already small enough, use full-size
                if (meta.size < 50000) {
                    var url = self._createObjectUrl(attachmentId, blob);
                    resolve(url);
                    return;
                }

                // Create thumbnail using canvas
                var img = new Image();
                img.onload = function() {
                    var width = img.width;
                    var height = img.height;

                    // Revoke the temp blob URL used for loading
                    URL.revokeObjectURL(img.src);

                    if (width <= maxSize && height <= maxSize) {
                        var url = self._createObjectUrl(attachmentId, blob);
                        resolve(url);
                        return;
                    }

                    // Scale down
                    var scale = Math.min(maxSize / width, maxSize / height);
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.round(width * scale);
                    canvas.height = Math.round(height * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    canvas.toBlob(function(thumbBlob) {
                        var thumbUrl = URL.createObjectURL(thumbBlob);
                        resolve(thumbUrl);
                    }, meta.type || 'image/jpeg', 0.7);
                };
                img.onerror = function() {
                    // Fallback to full-size URL
                    var url = self._createObjectUrl(attachmentId, blob);
                    resolve(url);
                };
                img.src = URL.createObjectURL(blob);
            }).catch(function(err) {
                reject(err);
            });
        });
    },

    
    openBrowser: function(onSelect) {
        if (!window.ModalManager) {
            console.error('[AttachmentsManager] ModalManager not available');
            return;
        }

        var attachments = this.list();
        // Create or get the modal
        var modal = document.getElementById('attachment-browser-modal');
        if (!modal) {
            // Modal HTML should be in index.html; if missing, create it
            modal = this._createModal();
        }

        var grid = document.getElementById('attachment-grid');
        if (!grid) return;

        if (attachments.length === 0) {
            grid.innerHTML = '<div class="attachment-empty">No attachments yet. Drop or paste an image in the editor to upload.</div>';
        } else {
            grid.innerHTML = '';
            var self = this;
            attachments.forEach(function(meta) {
                var card = document.createElement('div');
                card.className = 'attachment-card';
                card.setAttribute('data-attachment-id', meta.id);

                // Thumbnail or file icon
                var preview = document.createElement('div');
                preview.className = 'attachment-preview';
                if (meta.isImage) {
                    self.getThumbnailURL(meta.id).then(function(url) {
                        if (url) {
                            var img = document.createElement('img');
                            img.src = url;
                            img.className = 'attachment-thumb';
                            preview.appendChild(img);
                        }
                    });
                } else {
                    var icon = document.createElement('div');
                    icon.className = 'attachment-file-icon';
                    icon.textContent = self._getFileIcon(meta.type);
                    preview.appendChild(icon);
                }
                card.appendChild(preview);

                // Info
                var info = document.createElement('div');
                info.className = 'attachment-info';
                var nameEl = document.createElement('div');
                nameEl.className = 'attachment-name';
                nameEl.textContent = meta.name.length > 25 ? meta.name.substring(0, 22) + '...' : meta.name;
                info.appendChild(nameEl);
                var sizeEl = document.createElement('div');
                sizeEl.className = 'attachment-size';
                sizeEl.textContent = self._formatSize(meta.size);
                info.appendChild(sizeEl);
                card.appendChild(info);

                // Delete button
                var delBtn = document.createElement('button');
                delBtn.className = 'attachment-del-btn';
                delBtn.title = 'Delete attachment';
                delBtn.textContent = '×';
                delBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (confirm('Delete "' + meta.name + '"?')) {
                        self.delete(meta.id).then(function() {
                            self.openBrowser(onSelect);
                        });
                    }
                });
                card.appendChild(delBtn);

                // Click to select
                card.addEventListener('click', function() {
                    if (typeof onSelect === 'function') {
                        onSelect(meta.id, meta);
                    }
                    ModalManager.close('attachment-browser-modal');
                });

                grid.appendChild(card);
            });
        }

        // Update count
        var countEl = document.getElementById('attachment-count');
        if (countEl) {
            countEl.textContent = attachments.length + ' file' + (attachments.length !== 1 ? 's' : '');
        }

        // Update total size
        var sizeEl = document.getElementById('attachment-total-size');
        if (sizeEl) {
            var totalBytes = this.getTotalSize();
            sizeEl.textContent = 'Total: ' + this._formatSize(totalBytes);
        }

        // Wire upload button + hidden file input
        var uploadBtn = document.getElementById('attachment-upload-btn');
        var fileInput = document.getElementById('attachment-file-input');
        if (uploadBtn && fileInput) {
            // Remove old listeners by cloning
            var newBtn = uploadBtn.cloneNode(true);
            // Reset state inherited from a previous upload (cloneNode copies
            // the disabled attribute and the 'Uploading...' text node)
            newBtn.disabled = false;
            newBtn.textContent = '+ Upload';
            uploadBtn.parentNode.replaceChild(newBtn, uploadBtn);
            var newInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newInput, fileInput);

            newBtn.addEventListener('click', function(e) {
                e.preventDefault();
                newInput.click();
            });

            newInput.addEventListener('change', function() {
                var files = newInput.files;
                if (!files || files.length === 0) return;

                // Disable button during upload
                newBtn.disabled = true;
                newBtn.textContent = 'Uploading...';

                var uploadPromises = [];
                for (var i = 0; i < files.length; i++) {
                    (function(file) {
                        uploadPromises.push(self.upload(file, { source: 'attachment-browser' }));
                    })(files[i]);
                }

                Promise.all(uploadPromises).then(function() {
                    // Clear input so same file can be re-selected
                    newInput.value = '';
                    // Refresh the browser
                    self.openBrowser(onSelect);
                }).catch(function(err) {
                    console.error('[AttachmentsManager] Upload failed:', err);
                    newBtn.disabled = false;
                    newBtn.textContent = '+ Upload';
                    newInput.value = '';
                });
            });
        }

        ModalManager.open('attachment-browser-modal');
    },

    
    _createModal: function() {
        var div = document.createElement('div');
        div.id = 'attachment-browser-modal';
        div.className = 'modal';
        div.innerHTML =
            '<div class="modal-content attachment-browser-content">' +
                '<div class="modal-header">' +
                    '<h2>📎 Attachments</h2>' +
                    '<span class="attachment-count-badge" id="attachment-count">0 files</span>' +
                    '<button class="close-modal" data-modal="attachment-browser-modal" aria-label="Close attachments">&times;</button>' +
                '</div>' +
                '<div class="attachment-grid" id="attachment-grid">' +
                    '<div class="attachment-empty">Loading...</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(div);

        // Wire close button
        var closeBtn = div.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                ModalManager.close('attachment-browser-modal');
            });
        }

        return div;
    },

    
    _getFileIcon: function(mimeType) {
        if (mimeType.indexOf('pdf') !== -1) return '📄';
        if (mimeType.indexOf('text') !== -1) return '📝';
        if (mimeType.indexOf('audio') !== -1) return '🎵';
        if (mimeType.indexOf('video') !== -1) return '🎬';
        if (mimeType.indexOf('zip') !== -1 || mimeType.indexOf('rar') !== -1 || mimeType.indexOf('tar') !== -1) return '📦';
        return '📎';
    },

    
    _formatSize: function(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
};
