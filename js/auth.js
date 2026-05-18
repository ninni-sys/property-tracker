// Google OAuth 2.0 — PKCE implicit-style flow for frontend-only apps
// Filled in Phase 2
const AUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

let _accessToken = null;
let _tokenExpiry  = 0;

function getAccessToken() { return _accessToken; }
function isAuthenticated() { return !!_accessToken && Date.now() < _tokenExpiry; }

// Stub — implemented in Phase 2
function signIn()  { console.warn('auth.js: signIn() not yet implemented'); }
function signOut() { console.warn('auth.js: signOut() not yet implemented'); }
function silentRefresh() { return Promise.resolve(false); }
