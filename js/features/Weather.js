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

        var location = State.CONFIG.location || 'London';

        // 1. Lazy Load Cache if missing (Fix for fresh load)
        if (!State.WEATHER_CACHE) {
            try {
                var cached = localStorage.getItem('OPERATOR_WEATHER_CACHE');
                if (cached) State.WEATHER_CACHE = JSON.parse(cached);
            } catch(e) { console.error('Weather cache load failed', e); }
        }

        // Cache Check (30 mins). Ensure we bust cache if the user changed the location settings.
        var now = Date.now();
        if (State.WEATHER_CACHE && State.WEATHER_CACHE.loc === location && (now - State.WEATHER_CACHE.time < 1800000)) {
            this.render(State.WEATHER_CACHE.data);
            return;
        }

        // V102: Preserving structure if possible, or showing loading text
        if (el.querySelector('.weather-condition')) {
            el.querySelector('.weather-condition').textContent = 'SYNCING...';
        } else {
             el.textContent = 'LOADING //';
        }
        el.classList.add('active'); // V102: Ensure visibility

        var geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(location) + '&count=1';

        fetch(geoUrl)
            .then(res => res.json())
            .then(geoData => {
                if (!geoData.results || !geoData.results[0]) throw new Error("Location not found");
                var lat = geoData.results[0].latitude;
                var lon = geoData.results[0].longitude;
                var resolvedName = geoData.results[0].name;
                var weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`;
                
                return fetch(weatherUrl).then(res => res.json()).then(wData => {
                    return { locationName: resolvedName, wData: wData };
                });
            })
            .then(result => {
                // Convert Open-Meteo to wttr.in legacy schema for the render layer
                var w = result.wData.current;
                
                // Helper to convert WMO codes to text
                const wmoToText = (code) => {
                    if (code === 0) return "Clear";
                    if (code === 1 || code === 2 || code === 3) return "Partly Cloudy";
                    if (code === 45 || code === 48) return "Fog";
                    if (code >= 51 && code <= 57) return "Drizzle";
                    if (code >= 61 && code <= 67) return "Rain";
                    if (code >= 71 && code <= 77) return "Snow";
                    if (code >= 80 && code <= 82) return "Rain Showers";
                    if (code >= 85 && code <= 86) return "Snow Showers";
                    if (code >= 95) return "Thunderstorm";
                    return "Unknown";
                };

                var tempC = Math.round(w.temperature_2m);
                var tempF = Math.round((w.temperature_2m * 9/5) + 32);

                var formattedData = {
                    current_condition: [{
                        temp_C: tempC.toString(),
                        temp_F: tempF.toString(),
                        weatherDesc: [{ value: wmoToText(w.weather_code) }],
                        humidity: Math.round(w.relative_humidity_2m).toString(),
                        windspeedKmph: Math.round(w.wind_speed_10m).toString(),
                        precipMM: w.precipitation.toString()
                    }],
                    resolvedLocation: result.locationName
                };

                State.WEATHER_CACHE = { time: Date.now(), data: formattedData, loc: location };
                this.render(formattedData);
                try {
                    localStorage.setItem('OPERATOR_WEATHER_CACHE', JSON.stringify(State.WEATHER_CACHE));
                } catch(e) {}
            })
            .catch(err => {
                console.error('Weather error:', err);
                
                // Fallback to cache (even if stale) if it exists for this location
                if (State.WEATHER_CACHE && State.WEATHER_CACHE.data && State.WEATHER_CACHE.loc === location) {
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
