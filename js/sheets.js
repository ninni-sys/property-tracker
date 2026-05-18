// Google Sheets API v4 — read/write for all five tabs

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column order per tab — must match order records are serialised into rows
const TAB_COLUMNS = {
  Properties: ['id','name','address','status','purchase_date','purchase_price','ownership_pct','sale_date','sale_price'],
  Income:     ['id','property_id','date','tax_year','amount','type','tenant_ref','receipt_ref','notes'],
  Expenses:   ['id','property_id','date','tax_year','amount','category','supplier','receipt_ref','notes','is_capital','status'],
  CGT:        ['id','property_id','category','description','amount','date','notes','source_expense_id'],
  GmailScan:  ['id','gmail_message_id','date','subject','suggested_supplier','suggested_amount','status','linked_expense_id'],
};

const SHEET_TABS = {
  properties: 'Properties',
  income:     'Income',
  expenses:   'Expenses',
  cgt:        'CGT',
  gmailScan:  'GmailScan',
};

// Numeric sheet ID cache (tab name → sheetId integer for batchUpdate calls)
const _sheetIdCache = {};

// ─── HTTP helper ──────────────────────────────────────────────
async function _req(url, opts = {}) {
  const token = getAccessToken();
  const headers = { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) };
  if (opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  let res = await fetch(url, { ...opts, headers });

  // 401 → silent refresh and retry once
  if (res.status === 401) {
    const ok = await silentRefresh();
    if (ok) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`;
      res = await fetch(url, { ...opts, headers });
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Sheets API ${res.status}: ${txt}`);
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// ─── Column letter helper ─────────────────────────────────────
function _colLetter(n) {
  // n is column count (1-based). Returns A, B, … Z, AA, etc.
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ─── Record ↔ row conversion ──────────────────────────────────
function _recordToRow(tabName, record) {
  return TAB_COLUMNS[tabName].map(col => {
    const v = record[col];
    return v === null || v === undefined ? '' : String(v);
  });
}

function _rowToRecord(tabName, row) {
  const cols = TAB_COLUMNS[tabName];
  const rec = {};
  cols.forEach((col, i) => { rec[col] = row[i] !== undefined ? row[i] : ''; });
  return rec;
}

// ─── Find row index for an ID (returns 1-based row, -1 if not found) ─
async function _findRow(tabName, id) {
  const cols = TAB_COLUMNS[tabName];
  const lastCol = _colLetter(cols.length);
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A:A`;
  const data = await _req(url);
  const rows = data.values || [];
  // rows[0] is header, data starts at rows[1] → sheet row 2
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return i + 1; // 1-based sheet row
  }
  return -1;
}

// ─── sheetsInit — ensure tabs exist with header rows ──────────
async function sheetsInit() {
  if (!isAuthenticated()) return;
  try {
    const meta = await _req(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`);
    const existing = new Set((meta.sheets || []).map(s => s.properties.title));

    // Cache sheetId for each existing tab
    (meta.sheets || []).forEach(s => {
      _sheetIdCache[s.properties.title] = s.properties.sheetId;
    });

    const toCreate = Object.values(SHEET_TABS).filter(t => !existing.has(t));

    if (toCreate.length > 0) {
      const requests = toCreate.map(title => ({
        addSheet: { properties: { title } }
      }));
      const result = await _req(`${SHEETS_BASE}/${SPREADSHEET_ID}:batchUpdate`, {
        method: 'POST',
        body: { requests },
      });
      // Cache newly created sheetIds
      (result.replies || []).forEach((reply, i) => {
        const props = reply.addSheet?.properties;
        if (props) _sheetIdCache[props.title] = props.sheetId;
      });
    }

    // Write header rows to empty tabs
    for (const tabName of Object.values(SHEET_TABS)) {
      const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A1:A1`;
      const check = await _req(url).catch(() => ({ values: [] }));
      const hasHeader = (check.values || []).length > 0 && check.values[0][0] === 'id';
      if (!hasHeader) {
        const headers = TAB_COLUMNS[tabName];
        const lastCol = _colLetter(headers.length);
        await _req(
          `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A1:${lastCol}1?valueInputOption=RAW`,
          { method: 'PUT', body: { values: [headers] } }
        );
      }
    }
  } catch (err) {
    console.warn('sheetsInit failed:', err.message);
  }
}

// ─── sheetsRead — returns array of record objects ─────────────
async function sheetsRead(tabName) {
  if (!isAuthenticated()) return [];
  try {
    const cols = TAB_COLUMNS[tabName];
    const lastCol = _colLetter(cols.length);
    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A1:${lastCol}`;
    const data = await _req(url);
    const rows = data.values || [];
    if (rows.length <= 1) return []; // header only or empty
    return rows.slice(1).map(row => _rowToRecord(tabName, row));
  } catch (err) {
    console.warn(`sheetsRead(${tabName}) failed:`, err.message);
    return [];
  }
}

// ─── sheetsAppend — adds one row ──────────────────────────────
async function sheetsAppend(tabName, record) {
  if (!isAuthenticated()) return null;
  try {
    const cols = TAB_COLUMNS[tabName];
    const lastCol = _colLetter(cols.length);
    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A:${lastCol}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    return await _req(url, {
      method: 'POST',
      body: { values: [_recordToRow(tabName, record)] },
    });
  } catch (err) {
    console.warn(`sheetsAppend(${tabName}) failed:`, err.message);
    return null;
  }
}

// ─── sheetsUpdate — finds row by record.id and overwrites it ──
async function sheetsUpdate(tabName, record) {
  if (!isAuthenticated()) return null;
  try {
    const rowIndex = await _findRow(tabName, record.id);
    if (rowIndex === -1) {
      // Row not found — append instead
      return sheetsAppend(tabName, record);
    }
    const cols = TAB_COLUMNS[tabName];
    const lastCol = _colLetter(cols.length);
    const range = `${encodeURIComponent(tabName)}!A${rowIndex}:${lastCol}${rowIndex}`;
    const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`;
    return await _req(url, {
      method: 'PUT',
      body: { values: [_recordToRow(tabName, record)] },
    });
  } catch (err) {
    console.warn(`sheetsUpdate(${tabName}) failed:`, err.message);
    return null;
  }
}

// ─── sheetsDeleteRow — deletes row by record ID ───────────────
async function sheetsDeleteRow(tabName, id) {
  if (!isAuthenticated()) return null;
  try {
    const rowIndex = await _findRow(tabName, id);
    if (rowIndex === -1) return null;

    // Ensure we have the sheetId
    if (_sheetIdCache[tabName] === undefined) {
      const meta = await _req(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`);
      (meta.sheets || []).forEach(s => {
        _sheetIdCache[s.properties.title] = s.properties.sheetId;
      });
    }

    const sheetId = _sheetIdCache[tabName];
    return await _req(`${SHEETS_BASE}/${SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      body: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1, // 0-based
              endIndex:   rowIndex,
            },
          },
        }],
      },
    });
  } catch (err) {
    console.warn(`sheetsDeleteRow(${tabName}) failed:`, err.message);
    return null;
  }
}

// ─── syncFromSheets — pull all tabs into IndexedDB ────────────
// Only overwrites IndexedDB if Sheets has data (non-empty tab)
async function syncFromSheets() {
  if (!isAuthenticated()) return;
  try {
    const tabStoreMap = [
      { tab: 'Properties', store: 'properties' },
      { tab: 'Income',     store: 'income'     },
      { tab: 'Expenses',   store: 'expenses'   },
      { tab: 'CGT',        store: 'cgt'        },
      { tab: 'GmailScan',  store: 'gmailScan'  },
    ];

    for (const { tab, store } of tabStoreMap) {
      const records = await sheetsRead(tab);
      if (records.length === 0) continue;

      // Coerce numeric fields
      const coerced = records.map(r => {
        const out = { ...r };
        if (store === 'income')     { out.amount = parseFloat(r.amount) || 0; }
        if (store === 'expenses')   { out.amount = parseFloat(r.amount) || 0; out.is_capital = Number(r.is_capital) || 0; }
        if (store === 'cgt')        { out.amount = parseFloat(r.amount) || 0; }
        if (store === 'properties') { out.purchase_price = r.purchase_price ? parseFloat(r.purchase_price) : ''; out.ownership_pct = r.ownership_pct ? parseFloat(r.ownership_pct) : 100; }
        if (store === 'gmailScan')  { out.suggested_amount = r.suggested_amount ? parseFloat(r.suggested_amount) : 0; }
        return out;
      });

      for (const record of coerced) {
        if (record.id) await dbPut(store, record);
      }
    }
  } catch (err) {
    console.warn('syncFromSheets failed:', err.message);
  }
}
