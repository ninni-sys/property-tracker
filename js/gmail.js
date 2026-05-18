// Gmail API v1 — receipt scanner
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ─── HTTP helper ──────────────────────────────────────────────
async function _gmailReq(url, opts = {}) {
  const token = getAccessToken();
  const headers = { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) };
  const init = { ...opts, headers };

  let res = await fetch(url, init);

  if (res.status === 401) {
    const ok = await silentRefresh();
    if (ok) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`;
      res = await fetch(url, { ...init, headers });
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Gmail API ${res.status}: ${txt}`);
  }

  return res.json();
}

// ─── Decode base64url to string ───────────────────────────────
function _decodeBase64Url(str) {
  if (!str) return '';
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    try { return atob(base64); } catch { return ''; }
  }
}

// ─── Extract readable text from Gmail message payload ─────────
function _extractBody(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    return _decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return _decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return _decodeBase64Url(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (part.mimeType?.startsWith('multipart/') && part.parts) {
        const nested = _extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

// ─── Extract largest plausible £ amount from text ─────────────
function _extractAmount(text) {
  if (!text) return 0;
  const amounts = [];
  const patterns = [
    /£\s*([\d,]+(?:\.\d{2})?)/g,
    /GBP\s*([\d,]+(?:\.\d{2})?)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0 && val < 100000) amounts.push(val);
    }
  }
  return amounts.length ? Math.max(...amounts) : 0;
}

// ─── Extract supplier name from From header ───────────────────
function _extractSupplier(fromHeader) {
  if (!fromHeader) return '';
  const nameMatch = fromHeader.match(/^([^<]+)</);
  if (nameMatch) return nameMatch[1].trim().replace(/^["']|["']$/g, '');
  const domainMatch = fromHeader.match(/@([^.>@\s]+)/);
  if (domainMatch) {
    const label = domainMatch[1];
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return fromHeader;
}

// ─── Parse Gmail Date header to ISO yyyy-mm-dd ────────────────
function _parseGmailDate(dateHeader) {
  if (!dateHeader) return new Date().toISOString().slice(0, 10);
  try {
    const d = new Date(dateHeader);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

// ─── Main scanner ─────────────────────────────────────────────
// opts: { days: 30|60|90, query: string (optional keyword override) }
// Returns array of { gmail_message_id, subject, date, suggested_supplier, suggested_amount, body_preview }
async function scanGmail(opts = {}) {
  if (!isAuthenticated()) return [];

  const days  = opts.days  || 90;
  const extra = opts.query || '';

  const existing = await dbGetAll('gmailScan');
  const knownIds  = new Set(existing.map(r => r.gmail_message_id));

  const baseQuery = extra ||
    '(subject:receipt OR subject:invoice OR subject:payment OR subject:order OR subject:confirmation)';
  const query = `${baseQuery} newer_than:${days}d`;

  const listData = await _gmailReq(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=50`
  );

  const messages    = listData.messages || [];
  const newMessages = messages.filter(m => !knownIds.has(m.id));

  if (newMessages.length === 0) return [];

  const results = [];

  for (const msg of newMessages.slice(0, 25)) {
    try {
      const detail = await _gmailReq(`${GMAIL_BASE}/messages/${msg.id}?format=full`);

      const hdr = {};
      (detail.payload?.headers || []).forEach(h => { hdr[h.name.toLowerCase()] = h.value; });

      const subject  = hdr['subject'] || '(no subject)';
      const body     = _extractBody(detail.payload);
      const amount   = _extractAmount(body + ' ' + subject);
      const supplier = _extractSupplier(hdr['from'] || '');
      const date     = _parseGmailDate(hdr['date'] || '');
      const preview  = body.slice(0, 250).replace(/\s+/g, ' ').trim();

      results.push({ gmail_message_id: msg.id, subject, date, suggested_supplier: supplier, suggested_amount: amount, body_preview: preview });
    } catch (err) {
      console.warn(`scanGmail: failed to fetch ${msg.id}:`, err.message);
    }
  }

  return results;
}
