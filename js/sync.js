// Offline sync layer — queue, process, status indicator
// Stub — implemented in Phase 11
function setSyncStatus(status, label) {
  const el  = document.getElementById('sync-indicator');
  const dot = el?.querySelector('.sync-dot');
  const lbl = el?.querySelector('.sync-label');
  if (!el) return;
  el.className = `sync-indicator ${status}`;
  if (lbl) lbl.textContent = label || status;
}

function initSync() {
  window.addEventListener('online',  () => setSyncStatus('pending', 'Syncing…'));
  window.addEventListener('offline', () => setSyncStatus('error',   'Offline'));
  setSyncStatus(navigator.onLine ? 'synced' : 'error', navigator.onLine ? 'Synced' : 'Offline');
}
