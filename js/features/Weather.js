import { State } from '../core/Store.js';
import { SettingsUI } from '../ui/SettingsUI.js';
import { saveConfig } from '../core/Config.js';

/* =========================================
   WEATHER MODULE
   ========================================= */

export const Weather = {
    init: function() {
        if (State.CONFIG.weather_enabled !== false) {
            this.fetch();
        }
    },

    fetch: function() {
        var el = document.getElementById('weather-widget');
        if (!el) return;
        
        // V102: Logic Fix check 'location' (Store.js default) instead of 'weather_location'
        if (!State.CONFIG.location || State.CONFIG.location === '') {
            el.innerHTML = '<div class="weather-condition" style="margin:0">SET_LOCATION //</div>';
            el.classList.add('active'); // V102: Ensure visibility
            el.onclick = function() { SettingsUI.open('weather'); };
            return;
        }

        // 1. Lazy Load Cache if missing (Fix for fresh load)
        if (!State.WEATHER_CACHE) {
            try {
                var cached = localStorage.getItem('OPERATOR_WEATHER_CACHE');
                if (cached) State.WEATHER_CACHE = JSON.parse(cached);
            } catch(e) { console.error('Weather cache load failed', e); }
        }

        // Cache Check (30 mins)
        var now = Date.now();
        if (State.WEATHER_CACHE && (now - State.WEATHER_CACHE.time < 1800000)) {
            this.render(State.WEATHER_CACHE.data);
            return;
        }

        var location = State.CONFIG.location || 'London';
        var url = 'https://wttr.in/' + encodeURIComponent(location) + '?format=j1';

        // V102: Preserving structure if possible, or showing loading text
        if (el.querySelector('.weather-condition')) {
            el.querySelector('.weather-condition').textContent = 'SYNCING...';
        } else {
             el.textContent = 'LOADING //';
        }
        el.classList.add('active'); // V102: Ensure visibility

        fetch(url)
            .then(res => res.json())
            .then(data => {
                State.WEATHER_CACHE = { time: Date.now(), data: data };
                this.render(data);
                try {
                    localStorage.setItem('OPERATOR_WEATHER_CACHE', JSON.stringify(State.WEATHER_CACHE));
                } catch(e) {}
            })
            .catch(err => {
                console.error('Weather error:', err);
                
                // Fallback to cache (even if stale)
                if (State.WEATHER_CACHE && State.WEATHER_CACHE.data) {
                     this.render(State.WEATHER_CACHE.data);
                     // Indicate offline status
                     var cond = el.querySelector('.weather-condition');
                     if (cond) cond.textContent = (cond.textContent || '') + ' (OFFLINE)';
                } else {
                    el.innerHTML = '<div class="weather-condition" style="margin:0">OFFLINE //</div>';
                    el.classList.add('active');
                }
            });
    },

    render: function(data) {
        var el = document.getElementById('weather-widget');
        if (!el || !data) return;

        var current = data.current_condition[0];
        var isC = State.CONFIG.use_celsius;
        var tempVal = isC ? current.temp_C : current.temp_F;
        var unitVal = isC ? 'C' : 'F';
        
        var cond = current.weatherDesc[0].value;
        var loc = State.CONFIG.location || 'Unknown';
        
        // V102: Legacy Structure (Toggle at BOTTOM)
        var html = `
            <div class="weather-main">
                <span class="weather-temp">${tempVal}°</span>
                <span class="weather-unit">${unitVal}</span>
            </div>
            <div class="weather-condition">${cond}</div>
            <div class="weather-location">${loc.toUpperCase()}</div>
            
            <div class="weather-extra ${State.CONFIG.weather_extended ? 'active' : ''}" id="weather-extra">
                <div class="weather-extra-row">
                    <span class="label">HUMIDITY</span>
                    <span class="value">${current.humidity}%</span>
                </div>
                <div class="weather-extra-row">
                    <span class="label">WIND</span>
                    <span class="value">${current.windspeedKmph}km/h</span>
                </div>
                <div class="weather-extra-row">
                    <span class="label">PRECIP</span>
                    <span class="value">${current.precipMM}mm</span>
                </div>
            </div>
            
            <div class="weather-toggle" id="weather-toggle-btn">
                [ ${State.CONFIG.weather_extended ? '-' : '+'} ]
            </div>
        `;

        el.innerHTML = html;
        el.classList.add('active');
        
        // Re-bind click locally
        var toggleBtn = el.querySelector('#weather-toggle-btn');
        if (toggleBtn) {
            toggleBtn.onclick = function(e) {
                e.stopPropagation();
                window.toggleWeather(); 
                // Also update the button text immediately for feedback
                var extended = document.getElementById('weather-extra').classList.contains('active');
                toggleBtn.innerText = extended ? '[ - ]' : '[ + ]'; // Toggle Logic
            };
        }
        
        el.onclick = function(e) {
            if (e.target.closest('.weather-toggle') || e.target.closest('.weather-extra')) return;
            SettingsUI.open('weather');
        };
    }
};

// Expose global for legacy calls (e.g. from CLI 'weather' command)
window.fetchWeather = Weather.fetch.bind(Weather);

export const fetchWeather = Weather.fetch.bind(Weather);
