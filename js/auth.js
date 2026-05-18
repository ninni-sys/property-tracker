// Google OAuth 2.0 — token client flow via Google Identity Services
const AUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

const LS_TOKEN  = 'pt_access_token';
const LS_EXPIRY = 'pt_token_expiry';

let _accessToken  = null;
let _tokenExpiry  = 0;
let _refreshTimer = null;

// ─── Public ───────────────────────────────────────────────────
function getAccessToken()  { return _accessToken; }
function isAuthenticated() { return !!_accessToken && Date.now() < _tokenExpiry - 30_000; }

// ─── GIS readiness ────────────────────────────────────────────
function waitForGIS() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    let tries = 0;
    const id = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(id); resolve(); return; }
      if (++tries > 100) { clearInterval(id); reject(new Error('Google Identity Services failed to load')); }
    }, 100);
  });
}

// ─── Token storage ────────────────────────────────────────────
function _saveToken(token, expiresIn) {
  _accessToken = token;
  _tokenExpiry = Date.now() + (Number(expiresIn) - 60) * 1000;
  localStorage.setItem(LS_TOKEN,  token);
  localStorage.setItem(LS_EXPIRY, String(_tokenExpiry));
  _scheduleRefresh();
}

function _loadStoredToken() {
  const token  = localStorage.getItem(LS_TOKEN);
  const expiry = parseInt(localStorage.getItem(LS_EXPIRY) || '0', 10);
  if (token && expiry > Date.now() + 60_000) {
    _accessToken = token;
    _tokenExpiry = expiry;
    _scheduleRefresh();
    return true;
  }
  return false;
}

function _clearToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_EXPIRY);
  clearTimeout(_refreshTimer);
}

// ─── Auto-refresh (5 min before expiry) ──────────────────────
function _scheduleRefresh() {
  clearTimeout(_refreshTimer);
  const delay = _tokenExpiry - Date.now() - 5 * 60 * 1000;
  if (delay > 0) {
    _refreshTimer = setTimeout(async () => {
      const ok = await silentRefresh();
      if (!ok) {
        // Token couldn't be silently refreshed — force re-login next API call
        _clearToken();
      }
    }, delay);
  }
}

// ─── Silent refresh (no user interaction) ────────────────────
async function silentRefresh() {
  try {
    await waitForGIS();
    return await new Promise((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: AUTH_SCOPES,
        callback:       (r) => { if (!r.error && r.access_token) { _saveToken(r.access_token, r.expires_in); resolve(true); } else { resolve(false); } },
        error_callback: ()  => resolve(false),
      });
      client.requestAccessToken({ prompt: '' });
    });
  } catch {
    return false;
  }
}

// ─── Interactive sign-in ──────────────────────────────────────
async function signIn() {
  await waitForGIS();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: AUTH_SCOPES,
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        _saveToken(r.access_token, r.expires_in);
        resolve(r.access_token);
      },
      error_callback: (err) => reject(new Error(err.type || 'sign_in_cancelled')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

// ─── Sign-out ─────────────────────────────────────────────────
function signOut() {
  if (_accessToken) {
    try { google.accounts.oauth2.revoke(_accessToken, () => {}); } catch {}
  }
  _clearToken();
}

// ─── App init helper — returns true if already authenticated ──
async function initAuth() {
  if (_loadStoredToken()) return true;
  return silentRefresh();
}
