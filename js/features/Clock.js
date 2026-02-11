import { State } from '../core/Store.js';
import { safeText } from '../core/Utils.js';
import { checkStreakReset } from './Missions.js';

let SESSION_START = Date.now();
let LAST_STREAK_CHECK_DATE = new Date().toDateString();

export const Clock = {
    init: function() {
        this.updateTime();
        setInterval(() => this.updateTime(), 1000);
    },

    updateTime: function() {
        var now = new Date();
        var time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        var date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        var clockEl = document.getElementById('clock');
        var dateEl = document.getElementById('date');
        if (clockEl) clockEl.textContent = time;
        if (dateEl) dateEl.textContent = date.toUpperCase();

        // Check streak reset once per day
        var todayStr = now.toDateString();
        if (LAST_STREAK_CHECK_DATE !== todayStr) {
            LAST_STREAK_CHECK_DATE = todayStr;
            checkStreakReset();
        }

        this.updateGreeting(now.getHours());
        this.updateUptime();
    },

    updateGreeting: function(hour) {
        var greetingEl = document.getElementById('greeting');
        if (!greetingEl) return;

        var greeting;
        if (hour >= 5 && hour < 12) greeting = "GOOD MORNING";
        else if (hour >= 12 && hour < 17) greeting = "GOOD AFTERNOON";
        else if (hour >= 17 && hour < 21) greeting = "GOOD EVENING";
        else greeting = "WELCOME TO VINLAND";

        if (State.CONFIG.user_name && State.CONFIG.user_name.trim()) {
            greetingEl.innerHTML = greeting + ', <span class="name">' + safeText(State.CONFIG.user_name.toUpperCase()) + '</span>';
        } else {
            greetingEl.textContent = greeting;
        }
    },

    updateUptime: function() {
        var elapsed = Math.floor((Date.now() - SESSION_START) / 1000);
        var hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
        var minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
        var seconds = (elapsed % 60).toString().padStart(2, '0');

        var uptimeEl = document.getElementById('uptime');
        if (uptimeEl) {
            uptimeEl.textContent = 'SESSION: ' + hours + ':' + minutes + ':' + seconds;
        }
    }
};
