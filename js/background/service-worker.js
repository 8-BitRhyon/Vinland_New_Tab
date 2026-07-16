/**
 * Vinland Background Service Worker (Manifest V3)
 *
 * Handles:
 *  - Extension lifecycle (install/update)
 *  - Pomodoro completion alarms → native OS notifications
 *  - Notification click → opens Vinland new tab
 *  - Message relay from extension pages (new tab)
 */

// ──────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Initialize pomodoro storage
    chrome.storage.local.set({
      pomodoro: {
        active: false,
        paused: false,
        endTime: null,
        remaining: 0,
        originalDuration: 0,
      },
      pomodoroCompleted: false,
      pomodoroAcknowledged: false,
    });
    console.log('[SW] Vinland SW installed — storage initialized.');
  }

  if (details.reason === 'update') {
    // Clear any stale alarms from previous versions
    chrome.alarms.clearAll(() => {
      console.log('[SW] Previous version alarms cleared.');
    });
  }
});

// ──────────────────────────────────────────
// Message handling from extension pages
// ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_POMO': {
      const durationMs = message.duration;
      const durationMinutes = durationMs / 60000;

      chrome.storage.local.set({
        pomodoro: {
          active: true,
          paused: false,
          endTime: Date.now() + durationMs,
          remaining: durationMs,
          originalDuration: durationMs,
        },
        pomodoroCompleted: false,
        pomodoroAcknowledged: false,
      });

      // chrome.alarms requires at least 1 minute delay
      if (durationMinutes >= 1) {
        chrome.alarms.create('pomo-end', {
          delayInMinutes: durationMinutes,
        });
        console.log('[SW] Pomo alarm set for', durationMinutes, 'minutes');
      }

      sendResponse({ success: true });
      break;
    }

    case 'STOP_POMO': {
      chrome.alarms.clear('pomo-end');
      chrome.storage.local.set({
        pomodoro: {
          active: false,
          paused: false,
          endTime: null,
          remaining: 0,
          originalDuration: 0,
        },
      });
      sendResponse({ success: true });
      break;
    }

    case 'PAUSE_POMO': {
      chrome.alarms.clear('pomo-end');
      chrome.storage.local.set({
        pomodoro: {
          active: true,
          paused: true,
          endTime: null,
          remaining: message.remaining,
          originalDuration: message.originalDuration,
        },
      });
      sendResponse({ success: true });
      break;
    }

    case 'RESUME_POMO': {
      const remainingMs = message.remaining;
      const remainingMinutes = remainingMs / 60000;

      chrome.storage.local.set({
        pomodoro: {
          active: true,
          paused: false,
          endTime: Date.now() + remainingMs,
          remaining: remainingMs,
          originalDuration: message.originalDuration,
        },
        pomodoroCompleted: false,
        pomodoroAcknowledged: false,
      });

      if (remainingMinutes >= 1) {
        chrome.alarms.create('pomo-end', {
          delayInMinutes: remainingMinutes,
        });
      }

      sendResponse({ success: true });
      break;
    }

    case 'ACK_POMO': {
      chrome.storage.local.set({
        pomodoroCompleted: false,
        pomodoroAcknowledged: true,
      });
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ error: 'Unknown message type' });
      break;
  }

  // Keep the message channel open for async sendResponse
  return true;
});

// ──────────────────────────────────────────
// Pomodoro completion alarm → notification
// ──────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pomo-end') {
    console.log('[SW] Pomo alarm fired — showing notification');

    // Mark completion in storage so the new tab page picks it up
    chrome.storage.local.set(
      {
        pomodoro: { active: false, paused: false },
        pomodoroCompleted: true,
        pomodoroAcknowledged: false,
      },
      () => {
        // Show native OS notification
        chrome.notifications.create('pomo-complete', {
          type: 'basic',
          iconUrl: 'assets/brand/v2-icon-128.png',
          title: 'FOCUS SESSION COMPLETE',
          message: 'Operator: Session finished. Time for a break!',
          priority: 2,
          requireInteraction: true,
        });
      }
    );
  }
});

// ──────────────────────────────────────────
// Notification interaction
// ──────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'pomo-complete') {
    // Activate existing Vinland tab if one exists, otherwise create a new one
    // Query both extension page URL and chrome://newtab (for new tab override)
    chrome.tabs.query(
      {
        url: [
          `chrome-extension://${chrome.runtime.id}/index.html`,
          'chrome://newtab/',
          'chrome://newtab',
        ],
      },
      (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
        } else {
          chrome.tabs.create({ url: 'index.html' });
        }
      }
    );
    chrome.notifications.clear(notificationId);
  }
});

// NOTE: onClosed is intentionally NOT handled here.
// The SW's job is only to set pomodoroCompleted and show the notification.
// Acknowledgment state is managed by the new tab page via the ACK_POMO message.
// Handling onClosed would race with the page loading and suppress the modal.
