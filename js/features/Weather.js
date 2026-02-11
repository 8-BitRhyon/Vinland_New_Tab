import { State } from '../core/Store.js';

/* =========================================
   WEATHER CONTROLLER
   ========================================= */

// Cache key for localStorage
const CACHE_KEY = 'OPERATOR_WEATHER_CACHE';
const CACHE_DURATION = 1800000; // 30 minutes in ms

let WEATHER_CACHE = null;

export function fetchWeather() {
    var widget = document.getElementById('weather-widget');
    if (!widget) return;
    
    var CONFIG = State.CONFIG;

    if (!CONFIG.location || !CONFIG.location.trim()) {
        widget.classList.remove('active');
        return;
    }

    var now = Date.now();

    // Show loading indicator
    var conditionEl = document.getElementById('weather-condition');
    var locEl = document.getElementById('weather-location');
    if (conditionEl) {
        conditionEl.textContent = 'SYNCING_DATA...';
        conditionEl.classList.add('weather-loading');
    }
    if (locEl) locEl.classList.add('weather-loading');
    widget.classList.add('active');

    // Memory cache check
    if (!WEATHER_CACHE) {
        try {
            WEATHER_CACHE = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        } catch (e) {
            WEATHER_CACHE = {};
        }
    }

    // Use cache if valid
    if (WEATHER_CACHE.data && (now - WEATHER_CACHE.timestamp < CACHE_DURATION) && WEATHER_CACHE.location === CONFIG.location) {
        updateWeatherUI(WEATHER_CACHE.data);
        widget.classList.add('active');
        return;
    }

    // Fetch new data
    var loc = encodeURIComponent(CONFIG.location.trim());

    fetch('https://wttr.in/' + loc + '?format=j1')
        .then(function (response) {
            if (!response.ok) throw new Error('Weather fetch failed');
            return response.json();
        })
        .then(function (data) {
            WEATHER_CACHE = {
                timestamp: Date.now(),
                location: CONFIG.location,
                data: data
            };
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(WEATHER_CACHE));
            } catch (e) { }

            updateWeatherUI(data);
        })
        .catch(function (err) {
            console.error('Weather error:', err);
            // Show error state
            var conditionEl = document.getElementById('weather-condition');
            var locEl = document.getElementById('weather-location');
            if (conditionEl) {
                conditionEl.textContent = 'LOCATION_ERROR';
                conditionEl.classList.remove('weather-loading');
                conditionEl.classList.add('weather-error');
            }
            if (locEl) {
                locEl.classList.remove('weather-loading');
                locEl.textContent = 'VERIFY_COORDINATES';
            }
            if (document.getElementById('weather-temp')) document.getElementById('weather-temp').textContent = '--';
            if (document.getElementById('weather-unit')) document.getElementById('weather-unit').textContent = '';
        });
}

function updateWeatherUI(data) {
    var CONFIG = State.CONFIG;
    if (!data || !data.current_condition || !data.current_condition[0]) {
        console.warn('Weather data missing current_condition');
        return;
    }
    var current = data.current_condition[0];
    var temp = CONFIG.use_celsius ? current.temp_C : current.temp_F;
    var unit = CONFIG.use_celsius ? 'C' : 'F';
    var condition = current.weatherDesc[0].value;
    var humidity = current.humidity;
    var windKph = current.windspeedKmph;
    var feelsC = current.FeelsLikeC;
    var feelsF = current.FeelsLikeF;
    var feels = CONFIG.use_celsius ? feelsC : feelsF;

    if (document.getElementById('weather-temp')) document.getElementById('weather-temp').textContent = temp;
    if (document.getElementById('weather-unit')) document.getElementById('weather-unit').textContent = String.fromCharCode(176) + unit;
    
    var conditionEl = document.getElementById('weather-condition');
    var locEl = document.getElementById('weather-location');
    
    if (conditionEl) {
        conditionEl.textContent = condition.toUpperCase();
        conditionEl.classList.remove('weather-loading', 'weather-error');
    }
    if (locEl) {
        locEl.textContent = CONFIG.location.toUpperCase();
        locEl.classList.remove('weather-loading');
    }
    if (document.getElementById('weather-humidity')) document.getElementById('weather-humidity').textContent = humidity + '%';
    if (document.getElementById('weather-wind')) document.getElementById('weather-wind').textContent = windKph + ' km/h';
    if (document.getElementById('weather-feels')) document.getElementById('weather-feels').textContent = feels + String.fromCharCode(176);

    var extraEl = document.getElementById('weather-extra');
    if (extraEl) {
        if (CONFIG.weather_extended) extraEl.classList.add('active');
        else extraEl.classList.remove('active');
    }
}
