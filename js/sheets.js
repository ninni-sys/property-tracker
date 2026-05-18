// Google Sheets API v4 — read/write for all five tabs
// Stub — implemented in Phase 3
const SHEET_TABS = {
  properties: 'Properties',
  income:     'Income',
  expenses:   'Expenses',
  cgt:        'CGT',
  gmailScan:  'GmailScan',
};

async function sheetsRead(tab)          { return []; }
async function sheetsAppend(tab, row)   { return null; }
async function sheetsUpdate(tab, rowIndex, row) { return null; }
async function sheetsDeleteRow(tab, rowIndex)   { return null; }
