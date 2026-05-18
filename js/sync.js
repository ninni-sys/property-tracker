// Offline sync layer — status indicator, queue processor, background sync

// ─── Status indicator ─────────────────────────────────────────
function setSyncStatus(status, label) {
  const el  = document.getElementById('sync-indicator');
  if (!el) return;
  el.className = `sync-indicator ${status}`;
  const lbl = el.querySelector('.sync-label');
  if (lbl) lbl.textContent = label || status;
}

// Update the pending-count badge on the sync indicator
async function _updateSyncBadge() {
  const queue = await getPendingQueue().catch(() => []);
  const count = queue.length;
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  badge.textContent = count > 0 ? String(count) : '';
  badge.classList.toggle('hidden', count === 0);
}

// ─── Queue processor ──────────────────────────────────────────
// Drains syncQueue by replaying each queued Sheets operation in order.
// Leaves failed ops in the queue for the next attempt.
async function processQueue() {
  if (!isAuthenticated() || !navigator.onLine) return;

  const queue = await getPendingQueue().catch(() => []);
  if (queue.length === 0) return;

  setSyncStatus('pending', `Syncing ${queue.length}…`);

  for (const op of queue) {
    try {
      if      (op.action === 'append') await sheetsAppend(op.tabName, op.record);
      else if (op.action === 'update') await sheetsUpdate(op.tabName, op.record);
      else if (op.action === 'delete') await sheetsDeleteRow(op.tabName, op.id);
      await dequeueOperation(op.id);
    } catch (err) {
      console.warn('processQueue: op failed, leaving in queue:', err.message, op);
    }
  }

  const remaining = await getPendingQueue().catch(() => []);
  if (remaining.length === 0) {
    setSyncStatus('synced', 'Synced');
  } else {
    setSyncStatus('error', `${remaining.length} pending`);
  }
  _updateSyncBadge();
}

// ─── Init ─────────────────────────────────────────────────────
function initSync() {
  setSyncStatus(navigator.onLine ? 'synced' : 'error', navigator.onLine ? 'Synced' : 'Offline');

  // Flush queue when connection is restored
  window.addEventListener('online', async () => {
    setSyncStatus('pending', 'Reconnecting…');
    await processQueue();
  });

  window.addEventListener('offline', () => {
    setSyncStatus('error', 'Offline');
  });

  // Register Background Sync so the SW can wake the queue flush
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then(reg => reg.sync.register('sheets-sync'))
      .catch(() => {});
  }
}
