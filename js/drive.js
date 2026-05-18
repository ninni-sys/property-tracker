// Google Drive API v3 — receipt image uploads
const DRIVE_BASE        = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const RECEIPT_FOLDER    = 'Property Tracker Receipts';

let _folderIdCache = null;

// ─── HTTP helper ──────────────────────────────────────────────
async function _driveReq(url, opts = {}) {
  const token = () => getAccessToken();
  const makeInit = (tok) => {
    const headers = { 'Authorization': `Bearer ${tok}`, ...(opts.headers || {}) };
    const init = { ...opts, headers };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return init;
  };

  let res = await fetch(url, makeInit(token()));

  if (res.status === 401) {
    const ok = await silentRefresh();
    if (ok) res = await fetch(url, makeInit(token()));
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Drive API ${res.status}: ${txt}`);
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// ─── Find or create the receipts folder ──────────────────────
async function _ensureFolder() {
  if (_folderIdCache) return _folderIdCache;

  const q = `name='${RECEIPT_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await _driveReq(
    `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`
  );

  if (res.files && res.files.length > 0) {
    _folderIdCache = res.files[0].id;
    return _folderIdCache;
  }

  const folder = await _driveReq(`${DRIVE_BASE}/files`, {
    method: 'POST',
    body: { name: RECEIPT_FOLDER, mimeType: 'application/vnd.google-apps.folder' },
  });
  _folderIdCache = folder.id;
  return _folderIdCache;
}

// ─── Upload a receipt image to Drive ─────────────────────────
// Returns the Drive file ID (used as receipt_ref), or null on failure.
// onProgress(pct 0–100) is called during upload if provided.
async function uploadReceipt(file, filename, onProgress) {
  if (!isAuthenticated()) return null;

  const folderId = await _ensureFolder();
  const metadata = { name: filename || file.name, parents: [folderId] };
  const boundary = 'pt_receipt_multipart';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (ev) => {
      const base64 = btoa(ev.target.result);
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\n` +
        `Content-Type: ${file.type || 'application/octet-stream'}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        base64 +
        `\r\n--${boundary}--`;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`);
      xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken()}`);
      xhr.setRequestHeader('Content-Type', `multipart/related; boundary="${boundary}"`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText).id); }
          catch   { reject(new Error('Unexpected Drive response')); }
        } else {
          reject(new Error(`Drive upload ${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Drive upload network error'));
      xhr.send(body);
    };

    reader.onerror = () => reject(new Error('Could not read file for upload'));
    reader.readAsBinaryString(file);
  });
}

// ─── Public helpers ───────────────────────────────────────────
function getReceiptUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// Drive file IDs are 25–44 chars of [A-Za-z0-9_-]
function isDriveFileId(ref) {
  return !!ref && /^[A-Za-z0-9_-]{25,}$/.test(ref);
}
