// Feeding Log JavaScript
// Uses AWS API Gateway + DynamoDB for persistence (syncs across all devices)

// API endpoint - UPDATE THIS after deploying your API Gateway
const API_BASE_URL = 'https://mkou7ep3mh.execute-api.us-east-1.amazonaws.com/prod';

const FEEDING_PASSWORD = 'business school';

// Local cache of feeding history
let feedingHistory = [];

// Track the last feeding for undo functionality
let lastFeedingId = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadHistory();
  // Update the "time ago" display every minute
  setInterval(updateTimeAgo, 60000);
});

function setupEventListeners() {
  document.getElementById('feedBtn').addEventListener('click', recordFeeding);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
  document.getElementById('undoBtn').addEventListener('click', undoLastFeeding);

  // Allow Enter key to submit
  document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      recordFeeding();
    }
  });
}

// Load feeding history from API
async function loadHistory() {
  try {
    const response = await fetch(`${API_BASE_URL}/feeding`);
    if (response.ok) {
      feedingHistory = await response.json();
    } else {
      console.error('Failed to load history:', response.status);
      feedingHistory = [];
    }
  } catch (e) {
    console.error('Error loading history:', e);
    feedingHistory = [];
  }
  updateDisplay();
}

// Record a new feeding
async function recordFeeding() {
  const passwordInput = document.getElementById('passwordInput');
  const password = passwordInput.value;

  // Check password
  if (password !== FEEDING_PASSWORD) {
    passwordInput.classList.add('error');
    passwordInput.value = '';
    passwordInput.placeholder = 'Incorrect password';
    setTimeout(() => {
      passwordInput.classList.remove('error');
      passwordInput.placeholder = 'Enter password';
    }, 2000);
    return;
  }

  const btn = document.getElementById('feedBtn');
  btn.textContent = 'Recording...';
  btn.disabled = true;

  const now = new Date();
  const feedingId = Date.now();
  const feeding = {
    timestamp: now.toISOString(),
    id: feedingId
  };

  try {
    const response = await fetch(`${API_BASE_URL}/feeding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feeding)
    });

    if (!response.ok) {
      throw new Error('Failed to record feeding');
    }

    // Add to local cache
    feedingHistory.unshift(feeding);
    if (feedingHistory.length > 50) {
      feedingHistory.pop();
    }

    updateDisplay();

    // Store the feeding ID for undo
    lastFeedingId = feedingId;

    // Clear password field
    passwordInput.value = '';

    // Visual feedback
    btn.textContent = '✓ Recorded!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

    // Show undo button
    const undoBtn = document.getElementById('undoBtn');
    undoBtn.style.display = 'inline-block';

    setTimeout(() => {
      btn.textContent = '🐟 I Just Fed bp!';
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);

    // Hide undo button after 30 seconds
    setTimeout(() => {
      if (lastFeedingId === feedingId) {
        undoBtn.style.display = 'none';
        lastFeedingId = null;
      }
    }, 30000);

  } catch (e) {
    console.error('Error recording feeding:', e);
    btn.textContent = '✗ Error - Try Again';
    btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
    setTimeout(() => {
      btn.textContent = '🐟 I Just Fed bp!';
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);
  }
}

// Undo the last feeding
async function undoLastFeeding() {
  if (!lastFeedingId) return;

  const undoBtn = document.getElementById('undoBtn');
  undoBtn.textContent = 'Undoing...';
  undoBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE_URL}/feeding/${lastFeedingId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to undo feeding');
    }

    // Remove from local cache
    const index = feedingHistory.findIndex(item => item.id === lastFeedingId);
    if (index !== -1) {
      feedingHistory.splice(index, 1);
    }

    updateDisplay();

    // Hide undo button and reset
    undoBtn.style.display = 'none';
    undoBtn.textContent = 'Undo';
    undoBtn.disabled = false;
    lastFeedingId = null;

    // Visual feedback
    const btn = document.getElementById('feedBtn');
    btn.textContent = 'Feeding undone';
    setTimeout(() => {
      btn.textContent = '🐟 I Just Fed bp!';
    }, 2000);

  } catch (e) {
    console.error('Error undoing feeding:', e);
    undoBtn.textContent = 'Undo failed';
    setTimeout(() => {
      undoBtn.textContent = 'Undo';
      undoBtn.disabled = false;
    }, 2000);
  }
}

// Clear all history
async function clearHistory() {
  if (!confirm('Are you sure you want to clear all feeding history?')) {
    return;
  }

  const clearBtn = document.getElementById('clearHistoryBtn');
  clearBtn.textContent = 'Clearing...';
  clearBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE_URL}/feeding`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to clear history');
    }

    feedingHistory = [];
    updateDisplay();
    clearBtn.textContent = 'Clear History';
    clearBtn.disabled = false;

  } catch (e) {
    console.error('Error clearing history:', e);
    clearBtn.textContent = 'Clear failed';
    setTimeout(() => {
      clearBtn.textContent = 'Clear History';
      clearBtn.disabled = false;
    }, 2000);
  }
}

// Update the entire display
function updateDisplay() {
  updateLastFed();
  updateTimeAgo();
  updateHistoryList();
}

// Update the "Last Fed" display
function updateLastFed() {
  const lastFedTime = document.getElementById('lastFedTime');
  const feedingIndicator = document.getElementById('feedingIndicator');

  if (feedingHistory.length === 0) {
    lastFedTime.textContent = 'Never recorded';
    feedingIndicator.textContent = '';
    feedingIndicator.className = 'feeding-indicator';
    return;
  }

  const lastFeeding = new Date(feedingHistory[0].timestamp);
  lastFedTime.textContent = formatDateTime(lastFeeding);
}

// Update the "time ago" and indicator
function updateTimeAgo() {
  const timeAgoEl = document.getElementById('timeAgo');
  const feedingIndicator = document.getElementById('feedingIndicator');

  if (feedingHistory.length === 0) {
    timeAgoEl.textContent = '';
    return;
  }

  const lastFeeding = new Date(feedingHistory[0].timestamp);
  const now = new Date();
  const hoursAgo = (now - lastFeeding) / (1000 * 60 * 60);

  timeAgoEl.textContent = formatTimeAgo(lastFeeding);

  // Update indicator based on time since last feeding
  if (hoursAgo < 8) {
    feedingIndicator.textContent = 'Recently fed';
    feedingIndicator.className = 'feeding-indicator recent';
  } else if (hoursAgo < 16) {
    feedingIndicator.textContent = 'May need feeding soon';
    feedingIndicator.className = 'feeding-indicator moderate';
  } else {
    feedingIndicator.textContent = 'Time to feed bp!';
    feedingIndicator.className = 'feeding-indicator overdue';
  }
}

// Update the history list
function updateHistoryList() {
  const historyList = document.getElementById('historyList');

  if (feedingHistory.length === 0) {
    historyList.innerHTML = '<p class="no-history">No feeding history yet</p>';
    return;
  }

  historyList.innerHTML = feedingHistory.map((item, index) => {
    const date = new Date(item.timestamp);
    const isLatest = index === 0;
    return `
      <div class="history-item ${isLatest ? 'latest' : ''}">
        <span>${formatDateTime(date)}</span>
        <span>${formatTimeAgo(date)}</span>
      </div>
    `;
  }).join('');
}

// Format a date for display
function formatDateTime(date) {
  const options = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  return date.toLocaleDateString('en-US', options);
}

// Format "time ago" string
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
}
