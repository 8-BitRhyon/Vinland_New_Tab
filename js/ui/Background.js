import { State } from '../core/Store.js';
import { DB } from '../core/Storage.js';

/* =========================================
   BACKGROUND MODULE
   Handles Video/Image Wallpapers & Filters
   ========================================= */

export const Background = {
    init: function() {
        this.video = document.getElementById('bg-video');
        this.bgImage = document.getElementById('bg-image');
        
        // Create background image element if it doesn't exist
        if (!this.bgImage) {
            this.bgImage = document.createElement('div');
            this.bgImage.id = 'bg-image';
            this.bgImage.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;z-index:0;opacity:0;transition:opacity 0.4s;';
            document.body.insertBefore(this.bgImage, document.body.firstChild);
        }

        this.apply();
    },

    apply: function() {
        var CONFIG = State.CONFIG;
        
        // Check background type
        if (CONFIG.background_type === 'color') {
            if (this.video) this.video.style.display = 'none';
            this.bgImage.style.display = 'none';
            document.body.style.backgroundColor = CONFIG.background_color || '#000';
            return;
        }

        var bgList = CONFIG.backgrounds && CONFIG.backgrounds.length > 0 ? CONFIG.backgrounds : [];

        // No backgrounds configured - use default or solid color
        if (bgList.length === 0) {
            this.tryLoadVideo('background.mp4');
            return;
        }

        var randomBg = bgList[Math.floor(Math.random() * bgList.length)].trim();

        // Check for Database Media
        if (randomBg.startsWith('db:')) {
            var key = randomBg.replace('db:', '');
            DB.get(key).then((blob) => {
                if (blob) {
                    var url = URL.createObjectURL(blob);
                    // Check if image or video
                    var isImg = blob.type.startsWith('image/') || key.match(/\.(jpg|jpeg|png|gif|webp)$/i);

                    if (isImg) {
                        if (this.video) this.video.style.display = 'none';
                        this.loadImage(url);
                    } else {
                        this.bgImage.style.display = 'none';
                        this.tryLoadVideo(url);
                    }
                } else {
                    console.log('Asset missing from Vault:', key);
                    this.tryLoadVideo('background.mp4');
                }
            }).catch((e) => {
                console.error('DB Error', e);
                this.tryLoadVideo('background.mp4');
            });
            return;
        }

        // Check file extension (Standard URL)
        var ext = randomBg.split('.').pop().toLowerCase().split('?')[0];
        var isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext);

        if (isImage) {
            if (this.video) this.video.style.display = 'none';
            this.loadImage(randomBg);
        } else {
            this.bgImage.style.display = 'none';
            this.tryLoadVideo(randomBg);
        }
    },

    loadImage: function(url) {
        var img = new Image();
        img.onload = () => {
            if (this.bgImage) {
                this.bgImage.style.backgroundImage = 'url(' + url + ')';
                this.bgImage.style.opacity = '1';
                this.bgImage.style.display = 'block';
                this.applyFilter();
            }
        };
        img.onerror = () => {
            console.log('Image load failed:', url);
            if (this.bgImage) this.bgImage.style.display = 'none';
            document.body.style.backgroundColor = State.CONFIG.background_color || '#000';
        };
        img.src = url;
    },

    tryLoadVideo: function(src) {
        if (!this.video) return;
        
        State.BG_RETRY_COUNT = 0;
        this.video.style.opacity = '0';
        this.video.style.display = 'block';
        this.video.src = src;

        this.video.oncanplay = () => {
            this.video.play().catch(e => console.log('Video autoplay blocked:', e));
            this.video.style.opacity = '1';
            this.applyFilter();
        };

        this.video.onerror = () => {
            State.BG_RETRY_COUNT++;
            if (State.BG_RETRY_COUNT > State.BG_MAX_RETRIES) {
                this.video.style.display = 'none';
                if (src !== 'background.mp4') this.tryLoadVideo('background.mp4');
                else document.body.style.backgroundColor = State.CONFIG.background_color || '#000';
                return;
            }
        };
    },

    applyFilter: function() {
        var CONFIG = State.CONFIG;
        if (CONFIG.filter_enabled === false) {
            if (this.video) this.video.style.filter = 'none';
            if (this.bgImage) this.bgImage.style.filter = 'none';
            return;
        }

        var gs = CONFIG.filter_grayscale !== undefined ? CONFIG.filter_grayscale : 100;
        var ct = CONFIG.filter_contrast !== undefined ? CONFIG.filter_contrast : 120;
        var br = CONFIG.filter_brightness !== undefined ? CONFIG.filter_brightness : 60;
        var bl = CONFIG.filter_blur !== undefined ? CONFIG.filter_blur : 0;

        var filter = 'grayscale(' + gs + '%) contrast(' + (ct / 100) + ') brightness(' + (br / 100) + ')';
        if (bl > 0) filter += ' blur(' + bl + 'px)';

        if (this.video) this.video.style.filter = filter;
        if (this.bgImage) this.bgImage.style.filter = filter;
    }
};
