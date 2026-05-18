// Main app — routing, rendering, UI wiring
// Pre-loaded properties (seeded into IndexedDB on first run if empty)
const SEED_PROPERTIES = [
  { id: 'prop-1', name: 'Milman Road',                    address: '',  status: 'active', purchase_date: '', purchase_price: '', ownership_pct: 100, sale_date: '', sale_price: '' },
  { id: 'prop-2', name: 'Annex, 79 Commonside, Sheffield', address: '', status: 'active', purchase_date: '', purchase_price: '', ownership_pct: 100, sale_date: '', sale_price: '' },
  { id: 'prop-3', name: '29 Modling House, London',        address: '', status: 'active', purchase_date: '', purchase_price: '', ownership_pct: 100, sale_date: '', sale_price: '' },
];

// ─── Routing ─────────────────────────────────────────────────
function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');
  const navBtn = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add('active');
  // Scroll page content to top
  document.getElementById('main-content')?.scrollTo(0, 0);
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(msg, type = '', duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast hidden'; }, duration);
}

// ─── Escape HTML ─────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Format helpers ───────────────────────────────────────────
function formatGBP(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Property helpers ────────────────────────────────────────
let _properties = [];

async function loadProperties() {
  _properties = await dbGetAll('properties');
  if (_properties.length === 0) {
    for (const p of SEED_PROPERTIES) {
      await dbPut('properties', p);
      _sheetsWrite('Properties', 'append', p);
    }
    _properties = SEED_PROPERTIES.slice();
  }
  populatePropertySelects();
  return _properties;
}

function getPropertyName(id) {
  return _properties.find(p => p.id === id)?.name || id;
}

function populatePropertySelects() {
  document.querySelectorAll('select[name="property_id"], .filter-select').forEach(sel => {
    if (sel.id && sel.id.includes('filter-property') || sel.id && !sel.id.includes('filter')) return;
  });

  const propertySelects = [
    ...document.querySelectorAll('select[name="property_id"]'),
  ];
  propertySelects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">Select property…</option>';
    _properties.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });

  const filterSelects = document.querySelectorAll('.filter-select[id*="property"]');
  filterSelects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">All properties</option>';
    _properties.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

function populateTaxYearSelects() {
  const years = getTaxYearList();
  const filterSelects = document.querySelectorAll('.filter-select[id*="year"]');
  filterSelects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">All years</option>';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

// ─── Dashboard ───────────────────────────────────────────────
async function renderDashboard() {
  const propFilter = document.getElementById('dash-filter-property')?.value;
  const yearFilter = document.getElementById('dash-filter-year')?.value;

  const [allIncome, allExpenses] = await Promise.all([
    dbGetAll('income'),
    dbGetAll('expenses'),
  ]);

  const income = allIncome.filter(r =>
    (!propFilter || r.property_id === propFilter) &&
    (!yearFilter || r.tax_year === yearFilter)
  );
  const expenses = allExpenses.filter(r =>
    (!propFilter || r.property_id === propFilter) &&
    (!yearFilter || r.tax_year === yearFilter)
  );

  const totalIncome     = income.reduce((s, r) => s + Number(r.amount), 0);
  const mortgageItems   = expenses.filter(e => expenseType(e.category) === 'mortgage');
  const allowableItems  = expenses.filter(e => expenseType(e.category) === 'revenue');
  const capitalItems    = expenses.filter(e => expenseType(e.category) === 'capital');
  const uncatItems      = expenses.filter(e => expenseType(e.category) === 'uncategorised');

  const mortgage    = mortgageItems.reduce((s, e) => s + Number(e.amount), 0);
  const allowable   = allowableItems.reduce((s, e) => s + Number(e.amount), 0);
  const capital     = capitalItems.reduce((s, e) => s + Number(e.amount), 0);
  const uncatTotal  = uncatItems.reduce((s, e) => s + Number(e.amount), 0);

  // UK rental income tax logic
  const netProfit        = totalIncome - allowable;
  const credit           = mortgageTaxCredit(mortgage); // mortgage × 20%
  const taxGrossBasic    = Math.max(0, netProfit) * 0.20;
  const taxGrossHigher   = Math.max(0, netProfit) * 0.40;
  const taxPayableBasic  = Math.max(0, taxGrossBasic  - credit);
  const taxPayableHigher = Math.max(0, taxGrossHigher - credit);

  // ── Metric cards ──────────────────────────────────────────
  document.getElementById('dash-total-income').textContent  = formatGBP(totalIncome);
  document.getElementById('dash-income-sub').textContent    = `${income.length} record${income.length !== 1 ? 's' : ''}`;
  document.getElementById('dash-total-expenses').textContent = formatGBP(allowable);
  document.getElementById('dash-expenses-sub').textContent  = `${allowableItems.length} item${allowableItems.length !== 1 ? 's' : ''} · excl. mortgage`;

  const npEl   = document.getElementById('dash-net-profit');
  const npCard = document.getElementById('dash-net-profit-card');
  npEl.textContent = formatGBP(netProfit);
  npCard.classList.toggle('metric-positive', netProfit > 0);
  npCard.classList.toggle('metric-negative', netProfit < 0 && totalIncome > 0);

  document.getElementById('dash-uncategorised-count').textContent  = `${uncatItems.length} item${uncatItems.length !== 1 ? 's' : ''}`;
  document.getElementById('dash-uncategorised-amount').textContent = formatGBP(uncatTotal);

  // ── Uncategorised alert banner ────────────────────────────
  const alertEl   = document.getElementById('dash-uncat-alert');
  const alertText = document.getElementById('dash-uncat-alert-text');
  if (uncatItems.length > 0) {
    alertText.textContent = `${uncatItems.length} expense${uncatItems.length !== 1 ? 's' : ''} totalling ${formatGBP(uncatTotal)} need categorising and are excluded from the tax calculation.`;
    alertEl.classList.remove('hidden');
  } else {
    alertEl.classList.add('hidden');
  }

  // ── Tax computation panel ─────────────────────────────────
  document.getElementById('tc-income').textContent      = formatGBP(totalIncome);
  document.getElementById('tc-allowable').textContent   = `−${formatGBP(allowable)}`;
  const tcNetEl = document.getElementById('tc-net-profit');
  tcNetEl.textContent   = formatGBP(netProfit);
  tcNetEl.style.color   = netProfit < 0 ? 'var(--danger)' : netProfit > 0 ? 'var(--accent)' : '';
  document.getElementById('tc-mortgage').textContent    = formatGBP(mortgage);
  document.getElementById('tc-tax-basic').textContent   = formatGBP(taxGrossBasic);
  document.getElementById('tc-tax-higher').textContent  = formatGBP(taxGrossHigher);
  document.getElementById('tc-credit').textContent      = `−${formatGBP(credit)}`;
  document.getElementById('tc-payable-basic').textContent  = formatGBP(taxPayableBasic);
  document.getElementById('tc-payable-higher').textContent = formatGBP(taxPayableHigher);

  // ── Capital improvements section ──────────────────────────
  const capitalCard = document.getElementById('dash-capital-card');
  if (capitalItems.length > 0) {
    capitalCard.classList.remove('hidden');
    const rows = capitalItems
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(e => `<tr>
        <td>${getPropertyName(e.property_id)}</td>
        <td>${formatDate(e.date)}</td>
        <td>${e.supplier || '—'}</td>
        <td>${e.notes || '—'}</td>
        <td>${formatGBP(e.amount)}</td>
      </tr>`).join('');
    document.getElementById('dash-capital-table').innerHTML = `
      <table>
        <thead><tr><th>Property</th><th>Date</th><th>Supplier</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tfoot-total"><th colspan="4">Total capital costs</th><th>${formatGBP(capital)}</th></tr></tfoot>
      </table>`;
  } else {
    capitalCard.classList.add('hidden');
  }

  // ── Per-property breakdown ────────────────────────────────
  const propBreakdownEl = document.getElementById('dash-property-breakdown');
  const propsToShow = propFilter ? _properties.filter(p => p.id === propFilter) : _properties;

  if (propsToShow.length === 0 || (totalIncome === 0 && allowable === 0 && mortgage === 0)) {
    propBreakdownEl.innerHTML = '<p class="empty-state">No data yet.</p>';
  } else {
    const rows = propsToShow.map(prop => {
      const pIncome    = income.filter(r => r.property_id === prop.id).reduce((s, r) => s + Number(r.amount), 0);
      const pAllowable = expenses.filter(e => e.property_id === prop.id && expenseType(e.category) === 'revenue').reduce((s, e) => s + Number(e.amount), 0);
      const pMortgage  = expenses.filter(e => e.property_id === prop.id && expenseType(e.category) === 'mortgage').reduce((s, e) => s + Number(e.amount), 0);
      const pProfit    = pIncome - pAllowable;
      const pCredit    = mortgageTaxCredit(pMortgage);
      return `<tr>
        <td class="prop-breakdown-name">${prop.name}</td>
        <td>${formatGBP(pIncome)}</td>
        <td>${formatGBP(pAllowable)}</td>
        <td>${formatGBP(pMortgage)}</td>
        <td class="${pProfit >= 0 ? 'amount-positive' : 'amount-negative'}">${formatGBP(pProfit)}</td>
        <td class="amount-positive">${formatGBP(pCredit)}</td>
      </tr>`;
    }).join('');
    propBreakdownEl.innerHTML = `
      <table class="breakdown-table">
        <thead><tr>
          <th>Property</th><th>Income</th><th>Expenses</th>
          <th>Mortgage</th><th>Net Profit</th><th>Tax Credit</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Income by type ────────────────────────────────────────
  const incomeByType = {};
  income.forEach(r => { incomeByType[r.type] = (incomeByType[r.type] || 0) + Number(r.amount); });
  const incomeTableEl = document.getElementById('dash-income-table');
  if (Object.keys(incomeByType).length === 0) {
    incomeTableEl.innerHTML = '<p class="empty-state">No income recorded yet.</p>';
  } else {
    const incTotal = Object.values(incomeByType).reduce((a, b) => a + b, 0);
    const rows = Object.entries(incomeByType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, amt]) => {
        const pct = incTotal > 0 ? Math.round(amt / incTotal * 100) : 0;
        return `<tr><td>${type}</td><td>${formatGBP(amt)}</td><td class="pct-cell">${pct}%</td></tr>`;
      }).join('');
    incomeTableEl.innerHTML = `
      <table>
        <thead><tr><th>Type</th><th>Amount</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tfoot-total"><th>Total</th><th>${formatGBP(incTotal)}</th><th>100%</th></tr></tfoot>
      </table>`;
  }

  // ── Expenses by category ──────────────────────────────────
  // Include mortgage + allowable + capital; exclude uncategorised
  const expByCategory = {};
  const expTypeMap    = {};
  expenses.forEach(r => {
    const type = expenseType(r.category);
    if (type === 'uncategorised' || type === 'non-allowable') return;
    expByCategory[r.category] = (expByCategory[r.category] || 0) + Number(r.amount);
    expTypeMap[r.category] = type;
  });
  const expTableEl = document.getElementById('dash-expense-table');
  if (Object.keys(expByCategory).length === 0) {
    expTableEl.innerHTML = uncatItems.length > 0
      ? '<p class="empty-state">All expenses are uncategorised — use the Review tab to categorise them.</p>'
      : '<p class="empty-state">No expenses recorded yet.</p>';
  } else {
    const expTotal = Object.values(expByCategory).reduce((a, b) => a + b, 0);
    const rows = Object.entries(expByCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const type  = expTypeMap[cat];
        const badge = type === 'mortgage' ? '<span class="tag">Mortgage</span>'
                    : type === 'capital'  ? '<span class="tag capital">Capital</span>'
                    : '';
        const pct   = expTotal > 0 ? Math.round(amt / expTotal * 100) : 0;
        return `<tr><td>${cat} ${badge}</td><td>${formatGBP(amt)}</td><td class="pct-cell">${pct}%</td></tr>`;
      }).join('');
    expTableEl.innerHTML = `
      <table>
        <thead><tr><th>Category</th><th>Amount</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tfoot-total"><th>Total (incl. mortgage)</th><th>${formatGBP(expTotal)}</th><th>100%</th></tr></tfoot>
      </table>`;
  }
}

// ─── Income ledger ────────────────────────────────────────────
// ─── Income ledger ────────────────────────────────────────────
async function renderIncomeLedger() {
  const propFilter = document.getElementById('income-filter-property')?.value;
  const yearFilter = document.getElementById('income-filter-year')?.value;
  const typeFilter = document.getElementById('income-filter-type')?.value;
  const all  = await dbGetAll('income');
  const rows = all
    .filter(r =>
      (!propFilter || r.property_id === propFilter) &&
      (!yearFilter || r.tax_year    === yearFilter) &&
      (!typeFilter || r.type        === typeFilter)
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const el       = document.getElementById('income-ledger');
  const totalBar = document.getElementById('income-ledger-total');
  const totalVal = document.getElementById('income-ledger-total-value');

  if (rows.length === 0) {
    el.innerHTML = '<p class="empty-state">No income recorded yet.</p>';
    totalBar?.classList.add('hidden');
    return;
  }

  const filteredTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (totalVal) totalVal.textContent = formatGBP(filteredTotal);
  totalBar?.classList.remove('hidden');

  const isDeposit = (r) => r.type === 'Deposit received';

  el.innerHTML = rows.map(r => `
    <div class="ledger-item${isDeposit(r) ? ' income-deposit' : ''}" data-income-id="${r.id}">
      <div class="ledger-item-header">
        <span class="ledger-item-title">${getPropertyName(r.property_id)}</span>
        <div class="ledger-item-right">
          <span class="ledger-item-amount income-amount">${formatGBP(r.amount)}</span>
          <div class="ledger-item-actions">
            <button class="btn btn-ghost btn-xs" data-edit-income="${r.id}">Edit</button>
            <button class="btn btn-danger btn-xs" data-delete-income="${r.id}">Del</button>
          </div>
        </div>
      </div>
      <div class="ledger-item-meta">
        <span class="ledger-item-date">${formatDate(r.date)}</span>
        <span class="tag income">${r.type}</span>
        ${r.tenant_ref  ? `<span class="tag">${r.tenant_ref}</span>`  : ''}
        ${r.receipt_ref ? `<span class="tag">📄 ${r.receipt_ref}</span>` : ''}
        <span class="tag">${r.tax_year}</span>
      </div>
      ${r.notes ? `<div class="ledger-item-notes">${r.notes}</div>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('[data-edit-income]').forEach(btn => {
    btn.addEventListener('click', () => openIncomeForm(btn.dataset.editIncome));
  });
  el.querySelectorAll('[data-delete-income]').forEach(btn => {
    btn.addEventListener('click', () => deleteIncome(btn.dataset.deleteIncome));
  });
}

// ─── Open income form (add or edit) ──────────────────────────
function openIncomeForm(id) {
  const panel   = document.getElementById('income-form-panel');
  const form    = document.getElementById('income-form');
  const titleEl = document.getElementById('income-form-title');
  const depositNote = document.getElementById('deposit-note');

  panel.classList.remove('hidden');
  form.reset();
  depositNote.classList.add('hidden');
  document.querySelectorAll('#income-form .field-error').forEach(e => e.classList.add('hidden'));

  if (id) {
    dbGet('income', id).then(r => {
      if (!r) return;
      titleEl.textContent              = 'Edit Income';
      form.elements['id'].value        = r.id;
      form.elements['property_id'].value = r.property_id;
      form.elements['date'].value      = r.date;
      form.elements['type'].value      = r.type;
      form.elements['amount'].value    = r.amount;
      form.elements['tenant_ref'].value = r.tenant_ref || '';
      form.elements['receipt_ref'].value = r.receipt_ref || '';
      form.elements['notes'].value     = r.notes || '';
      if (r.type === 'Deposit received') depositNote.classList.remove('hidden');
    });
  } else {
    titleEl.textContent         = 'Add Income';
    form.elements['date'].value = new Date().toISOString().slice(0, 10);
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Delete income ────────────────────────────────────────────
async function deleteIncome(id) {
  if (!confirm('Delete this income record?')) return;
  await dbDelete('income', id);
  _sheetsWrite('Income', 'delete', null, id);
  await renderIncomeLedger();
  renderDashboard();
  showToast('Income record deleted', 'warn');
}

// ─── Expense ledger ───────────────────────────────────────────
async function renderExpenseLedger() {
  const propFilter = document.getElementById('expense-filter-property')?.value;
  const yearFilter = document.getElementById('expense-filter-year')?.value;
  const catFilter  = document.getElementById('expense-filter-category')?.value;
  const all = await dbGetAll('expenses');

  const rows = all
    .filter(r =>
      (!propFilter || r.property_id === propFilter) &&
      (!yearFilter || r.tax_year === yearFilter) &&
      (!catFilter  || r.category  === catFilter)
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  _populateCategoryFilter(all);

  const el       = document.getElementById('expense-ledger');
  const totalBar = document.getElementById('expense-ledger-total');
  const totalVal = document.getElementById('expense-ledger-total-value');

  if (rows.length === 0) {
    el.innerHTML = '<p class="empty-state">No expenses recorded yet.</p>';
    totalBar?.classList.add('hidden');
    return;
  }

  const filteredTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (totalVal) totalVal.textContent = formatGBP(filteredTotal);
  totalBar?.classList.remove('hidden');

  el.innerHTML = rows.map(r => {
    const type      = expenseType(r.category);
    const typeClass = { uncategorised: 'uncategorised', capital: 'capital', 'non-allowable': 'non-allowable' }[type] || '';
    const tagClass  = { uncategorised: 'warn', capital: 'capital' }[type] || '';

    const receiptHtml = isDriveFileId(r.receipt_ref)
      ? `<a href="${getReceiptUrl(r.receipt_ref)}" target="_blank" class="tag receipt-tag" title="View in Drive">📎 Receipt</a>`
      : r.receipt_ref
        ? `<span class="tag" title="${r.receipt_ref}">📎 ${r.receipt_ref.slice(0, 18)}</span>`
        : '';

    return `
      <div class="ledger-item ${typeClass}" data-expense-id="${r.id}">
        <div class="ledger-item-header">
          <span class="ledger-item-title">${getPropertyName(r.property_id)}</span>
          <div class="ledger-item-right">
            <span class="ledger-item-amount ${type === 'uncategorised' ? 'amount-warn' : ''}">−${formatGBP(r.amount)}</span>
            <div class="ledger-item-actions">
              <button class="btn btn-ghost btn-xs" data-edit-expense="${r.id}">Edit</button>
              <button class="btn btn-danger btn-xs" data-delete-expense="${r.id}">Del</button>
            </div>
          </div>
        </div>
        <div class="ledger-item-meta">
          <span class="ledger-item-date">${formatDate(r.date)}</span>
          <span class="tag ${tagClass}">${r.category}</span>
          ${r.supplier ? `<span class="tag">${r.supplier}</span>` : ''}
          <span class="tag">${r.tax_year}</span>
          ${receiptHtml}
        </div>
        ${r.notes ? `<div class="ledger-item-notes">${r.notes}</div>` : ''}
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-edit-expense]').forEach(btn => {
    btn.addEventListener('click', () => openExpenseForm(btn.dataset.editExpense));
  });
  el.querySelectorAll('[data-delete-expense]').forEach(btn => {
    btn.addEventListener('click', () => deleteExpense(btn.dataset.deleteExpense));
  });
}

function _populateCategoryFilter(allExpenses) {
  const sel = document.getElementById('expense-filter-category');
  if (!sel) return;
  const current = sel.value;
  const standardCats = [
    'Uncategorised', 'Mortgage interest', 'Insurance',
    'Letting agent / advertising', 'Repairs & maintenance', 'Utilities',
    'Professional fees', 'Replacement furnishings', 'Mileage', 'Other allowable',
    'Improvements', 'Personal / non-allowable',
  ];
  const usedCats = [...new Set(allExpenses.map(e => e.category))];
  const merged   = [...new Set([...standardCats, ...usedCats])];
  sel.innerHTML = '<option value="">All categories</option>' +
    merged.map(c => `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`).join('');
}

// ─── Open expense form (add or edit) ─────────────────────────
function openExpenseForm(id) {
  const panel       = document.getElementById('expense-form-panel');
  const form        = document.getElementById('expense-form');
  const titleEl     = document.getElementById('expense-form-title');
  const mileRow     = document.getElementById('mileage-row');
  const previewLink = document.getElementById('receipt-preview-link');
  const uploadStat  = document.getElementById('upload-status');

  panel.classList.remove('hidden');
  form.reset();
  mileRow.classList.add('hidden');
  previewLink.classList.add('hidden');
  uploadStat.classList.add('hidden');
  document.querySelectorAll('#expense-form .field-error').forEach(e => e.classList.add('hidden'));

  if (id) {
    dbGet('expenses', id).then(r => {
      if (!r) return;
      titleEl.textContent              = 'Edit Expense';
      form.elements['id'].value        = r.id;
      form.elements['property_id'].value = r.property_id;
      form.elements['date'].value      = r.date;
      form.elements['amount'].value    = r.amount;
      form.elements['category'].value  = r.category;
      form.elements['supplier'].value  = r.supplier || '';
      form.elements['receipt_ref'].value = isDriveFileId(r.receipt_ref) ? '' : (r.receipt_ref || '');
      form.elements['notes'].value     = r.notes || '';
      if (isDriveFileId(r.receipt_ref)) {
        previewLink.href = getReceiptUrl(r.receipt_ref);
        previewLink.classList.remove('hidden');
      }
      if (r.category === 'Mileage') mileRow.classList.remove('hidden');
    });
  } else {
    titleEl.textContent             = 'Add Expense';
    form.elements['date'].value     = new Date().toISOString().slice(0, 10);
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Delete expense ───────────────────────────────────────────
async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await dbDelete('expenses', id);
  _sheetsWrite('Expenses', 'delete', null, id);
  await renderExpenseLedger();
  await renderReviewList();
  renderDashboard();
  showToast('Expense deleted', 'warn');
}

// ─── To Review ────────────────────────────────────────────────
// Tracks total at first render for the progress bar
let _reviewTotal = 0;

async function renderReviewList() {
  const propFilter = document.getElementById('review-filter-property')?.value || '';
  const sortOrder  = document.getElementById('review-sort')?.value || 'oldest';

  const all = await dbGetAll('expenses');
  const allPending = all.filter(e => expenseType(e.category) === 'uncategorised');

  // ── Badge (all uncategorised, not filtered) ───────────────
  const badge = document.getElementById('review-badge');
  if (badge) {
    badge.textContent = allPending.length;
    badge.classList.toggle('hidden', allPending.length === 0);
  }

  // ── Progress tracking ─────────────────────────────────────
  if (allPending.length > 0 && allPending.length > _reviewTotal) {
    _reviewTotal = allPending.length;      // grows if new uncategorised items arrive
  }
  if (allPending.length === 0) _reviewTotal = 0;

  const reviewedCount = _reviewTotal - allPending.length;
  const pct = _reviewTotal > 0 ? Math.round(reviewedCount / _reviewTotal * 100) : 100;

  const header = document.getElementById('review-header');
  const fill   = document.getElementById('review-progress-fill');
  const progTx = document.getElementById('review-progress-text');

  if (allPending.length === 0) {
    header?.classList.add('hidden');
  } else {
    header?.classList.remove('hidden');
    if (fill)   fill.style.width = `${pct}%`;
    if (progTx) progTx.textContent =
      `${allPending.length} remaining${_reviewTotal > allPending.length ? ` · ${reviewedCount} done this session` : ''}`;
  }

  // ── Filter + sort visible items ───────────────────────────
  let visible = allPending.filter(e => !propFilter || e.property_id === propFilter);

  if (sortOrder === 'newest')  visible.sort((a, b) => b.date.localeCompare(a.date));
  else if (sortOrder === 'largest') visible.sort((a, b) => Number(b.amount) - Number(a.amount));
  else                         visible.sort((a, b) => a.date.localeCompare(b.date));

  // ── Render ────────────────────────────────────────────────
  const el = document.getElementById('review-list');

  if (allPending.length === 0) {
    el.innerHTML = `
      <div class="review-done-card">
        <div class="review-done-icon">✓</div>
        <div class="review-done-title">All caught up!</div>
        <p>Every expense has been categorised. Your tax calculation is up to date.</p>
        <button class="btn btn-primary" id="btn-review-to-dash">View Dashboard →</button>
      </div>`;
    document.getElementById('btn-review-to-dash')?.addEventListener('click', () => navigateTo('dashboard'));
    return;
  }

  if (visible.length === 0) {
    el.innerHTML = '<p class="empty-state">No items for this property. Try "All properties".</p>';
    return;
  }

  const categoryOptions = `
    <option value="Uncategorised">— choose a category —</option>
    <optgroup label="Revenue (tax deductible)">
      <option value="Mortgage interest">Mortgage interest</option>
      <option value="Insurance">Insurance</option>
      <option value="Letting agent / advertising">Letting agent / advertising</option>
      <option value="Repairs &amp; maintenance">Repairs &amp; maintenance</option>
      <option value="Utilities">Utilities</option>
      <option value="Professional fees">Professional fees</option>
      <option value="Replacement furnishings">Replacement furnishings</option>
      <option value="Mileage">Mileage</option>
      <option value="Other allowable">Other allowable</option>
    </optgroup>
    <optgroup label="Capital (CGT relevant)">
      <option value="Improvements">Improvements</option>
    </optgroup>
    <optgroup label="Not deductible">
      <option value="Personal / non-allowable">Personal / non-allowable</option>
    </optgroup>`;

  el.innerHTML = visible.map(r => {
    const receiptHtml = isDriveFileId(r.receipt_ref)
      ? `<a href="${getReceiptUrl(r.receipt_ref)}" target="_blank" class="tag receipt-tag">📎 Receipt</a>`
      : r.receipt_ref ? `<span class="tag">📎 ${r.receipt_ref.slice(0, 20)}</span>` : '';

    return `
      <div class="review-item" data-expense-id="${r.id}">
        <div class="review-item-header">
          <div class="review-item-left">
            <span class="review-item-prop">${getPropertyName(r.property_id)}</span>
            ${r.supplier ? `<span class="review-item-supplier">${r.supplier}</span>` : ''}
          </div>
          <span class="review-item-amount">−${formatGBP(r.amount)}</span>
        </div>
        <div class="review-item-meta">
          <span class="review-item-date">${formatDate(r.date)}</span>
          <span class="tag">${r.tax_year}</span>
          ${receiptHtml}
        </div>
        ${r.notes ? `<div class="review-item-notes">${r.notes}</div>` : ''}
        <select class="review-category-select" data-expense-id="${r.id}">
          ${categoryOptions}
        </select>
      </div>`;
  }).join('');

  el.querySelectorAll('.review-category-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const cat = e.target.value;
      if (cat === 'Uncategorised') return;

      const id   = e.target.dataset.expenseId;
      const item = e.target.closest('.review-item');

      // Animate out the card
      item.classList.add('review-item--done');
      e.target.disabled = true;

      // Save after animation
      await new Promise(r => setTimeout(r, 320));

      const record = await dbGet('expenses', id);
      if (record) {
        record.category = cat;
        await dbPut('expenses', record);
        _sheetsWrite('Expenses', 'update', record);
      }

      await renderReviewList();
      renderDashboard();
      renderExpenseLedger();
    });
  });
}

// ─── CGT ─────────────────────────────────────────────────────
// ─── CGT ─────────────────────────────────────────────────────
const CGT_ANNUAL_EXEMPTION = 3000; // 2024/25 and beyond

async function renderCGT() {
  const [cgtRecords, allExpenses] = await Promise.all([
    dbGetAll('cgt'),
    dbGetAll('expenses'),
  ]);
  const el = document.getElementById('cgt-properties');

  if (_properties.length === 0) {
    el.innerHTML = '<p class="empty-state">No properties found.</p>';
    return;
  }

  el.innerHTML = _properties.map(prop => {
    const records  = cgtRecords.filter(r => r.property_id === prop.id)
                               .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const costBase = records.reduce((s, r) => s + Number(r.amount), 0);
    const status   = prop.status || 'active';
    const statusLabel = { active: 'Active', vacant: 'Vacant', sold: 'Sold' }[status] || status;

    // Unimported capital improvements for this property
    const importedIds = new Set(records.map(r => r.source_expense_id).filter(Boolean));
    const unimported  = allExpenses.filter(e =>
      e.property_id === prop.id &&
      e.category    === 'Improvements' &&
      !importedIds.has(e.id)
    );

    const entriesHtml = records.length === 0
      ? '<p class="cgt-empty">No entries yet — use "+ Add Entry" or import from Expenses.</p>'
      : records.map(r => `
          <div class="cgt-entry-row">
            <div class="cgt-entry-info">
              <span class="cgt-entry-category">${r.category}</span>
              ${r.description ? `<span class="cgt-entry-desc">— ${r.description}</span>` : ''}
              ${r.date ? `<span class="cgt-entry-date">${formatDate(r.date)}</span>` : ''}
              ${r.source_expense_id ? `<span class="cgt-entry-imported">imported</span>` : ''}
            </div>
            <div class="cgt-entry-right">
              <span class="cgt-entry-amount">${formatGBP(r.amount)}</span>
              <div class="cgt-entry-actions">
                <button class="btn btn-ghost btn-xs" data-edit-cgt="${r.id}">Edit</button>
                <button class="btn btn-danger btn-xs" data-delete-cgt="${r.id}">Del</button>
              </div>
            </div>
          </div>`).join('');

    const gainHtml = _buildGainCalc(prop, costBase);

    return `
      <div class="cgt-property-card">
        <div class="cgt-card-header">
          <div>
            <div class="cgt-property-name">${prop.name}</div>
            ${prop.address ? `<div class="cgt-property-address">${prop.address.replace(/\n/g, ', ')}</div>` : ''}
          </div>
          <div class="cgt-card-header-right">
            <span class="property-status-badge ${status}">${statusLabel}</span>
            <div class="cgt-card-actions">
              <button class="btn btn-primary btn-sm" data-add-cgt-prop="${prop.id}">+ Add</button>
              ${unimported.length > 0
                ? `<button class="btn btn-secondary btn-sm" data-import-improvements="${prop.id}" title="${unimported.length} improvement${unimported.length !== 1 ? 's' : ''} to import">↓ ${unimported.length} improvement${unimported.length !== 1 ? 's' : ''}</button>`
                : ''}
            </div>
          </div>
        </div>

        <div class="cgt-entries">${entriesHtml}</div>

        <div class="cgt-cost-base-total">
          <span>Cost base total</span>
          <span class="cgt-cost-base-value">${formatGBP(costBase)}</span>
        </div>

        ${gainHtml}
      </div>`;
  }).join('');

  // Wire card-level add buttons
  el.querySelectorAll('[data-add-cgt-prop]').forEach(btn => {
    btn.addEventListener('click', () => openCGTForm(btn.dataset.addCgtProp, null));
  });
  el.querySelectorAll('[data-import-improvements]').forEach(btn => {
    btn.addEventListener('click', () => importCapitalImprovements(btn.dataset.importImprovements));
  });
  el.querySelectorAll('[data-edit-cgt]').forEach(btn => {
    btn.addEventListener('click', () => openCGTForm(null, btn.dataset.editCgt));
  });
  el.querySelectorAll('[data-delete-cgt]').forEach(btn => {
    btn.addEventListener('click', () => deleteCGTEntry(btn.dataset.deleteCgt));
  });
}

function _buildGainCalc(prop, costBase) {
  const salePrice = parseFloat(prop.sale_price) || 0;
  if (prop.status !== 'sold' || salePrice <= 0) return '';

  const grossGain     = salePrice - costBase;
  const taxableGain   = Math.max(0, grossGain - CGT_ANNUAL_EXEMPTION);
  const cgtBasic      = taxableGain * 0.18;
  const cgtHigher     = taxableGain * 0.24;
  const isLoss        = grossGain < 0;

  return `
    <div class="cgt-gain-calc">
      <div class="cgt-gain-heading">Estimated Gain on Disposal</div>
      <div class="cgt-gain-row">
        <span>Sale proceeds</span>
        <span>${formatGBP(salePrice)}</span>
      </div>
      <div class="cgt-gain-row cgt-gain-deduction">
        <span>Less: cost base</span>
        <span>−${formatGBP(costBase)}</span>
      </div>
      <div class="cgt-gain-row cgt-gain-subtotal ${isLoss ? 'cgt-gain-loss' : ''}">
        <span>${isLoss ? 'Capital loss' : 'Gross gain'}</span>
        <span>${isLoss ? '−' : ''}${formatGBP(Math.abs(grossGain))}</span>
      </div>
      ${isLoss ? `
        <p class="cgt-gain-note">A capital loss can be offset against gains in the same or future tax years. Report to HMRC even if no tax is due.</p>
      ` : `
      <div class="cgt-gain-row cgt-gain-deduction">
        <span>Less: annual CGT exemption (2024/25)</span>
        <span>−${formatGBP(Math.min(CGT_ANNUAL_EXEMPTION, grossGain))}</span>
      </div>
      <div class="cgt-gain-row cgt-gain-total">
        <span>Taxable gain</span>
        <span>${formatGBP(taxableGain)}</span>
      </div>
      <div class="cgt-gain-row">
        <span>CGT at 18% (basic rate taxpayer)</span>
        <span>${formatGBP(cgtBasic)}</span>
      </div>
      <div class="cgt-gain-row cgt-gain-higher">
        <span>CGT at 24% (higher rate taxpayer)</span>
        <span>${formatGBP(cgtHigher)}</span>
      </div>
      <p class="cgt-gain-note">Residential property CGT rates from 30 Oct 2024. Private Residence Relief, letting relief, and other deductions may apply. Consult an accountant before filing.</p>
      `}
    </div>`;
}

// ─── Open CGT entry form ──────────────────────────────────────
function openCGTForm(propertyId, id) {
  const panel   = document.getElementById('cgt-form-panel');
  const form    = document.getElementById('cgt-form');
  const titleEl = document.getElementById('cgt-form-title');

  panel.classList.remove('hidden');
  form.reset();
  document.querySelectorAll('#cgt-form .field-error').forEach(e => e.classList.add('hidden'));

  if (id) {
    dbGet('cgt', id).then(r => {
      if (!r) return;
      titleEl.textContent                = 'Edit CGT Entry';
      form.elements['id'].value          = r.id;
      form.elements['property_id'].value = r.property_id;
      form.elements['category'].value    = r.category;
      form.elements['description'].value = r.description || '';
      form.elements['amount'].value      = r.amount;
      form.elements['date'].value        = r.date || '';
      form.elements['notes'].value       = r.notes || '';
    });
  } else {
    titleEl.textContent = 'Add CGT Entry';
    if (propertyId) form.elements['property_id'].value = propertyId;
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Delete CGT entry ─────────────────────────────────────────
async function deleteCGTEntry(id) {
  if (!confirm('Delete this CGT entry?')) return;
  await dbDelete('cgt', id);
  _sheetsWrite('CGT', 'delete', null, id);
  await renderCGT();
  showToast('Entry deleted', 'warn');
}

// ─── Import capital improvements from Expenses ────────────────
async function importCapitalImprovements(propertyId) {
  const [allExpenses, cgtRecords] = await Promise.all([
    dbGetAll('expenses'),
    dbGetAll('cgt'),
  ]);

  const importedIds  = new Set(cgtRecords.map(r => r.source_expense_id).filter(Boolean));
  const toImport     = allExpenses.filter(e =>
    e.property_id === propertyId &&
    e.category    === 'Improvements' &&
    !importedIds.has(e.id)
  );

  if (toImport.length === 0) {
    showToast('No new improvements to import', 'warn');
    return;
  }

  for (const exp of toImport) {
    const record = {
      id:               generateId(),
      property_id:      propertyId,
      category:         'Capital improvement',
      description:      exp.supplier || exp.notes || '',
      amount:           Number(exp.amount),
      date:             exp.date,
      notes:            exp.notes || '',
      source_expense_id: exp.id,
    };
    await dbPut('cgt', record);
    _sheetsWrite('CGT', 'append', record);
  }

  await renderCGT();
  showToast(`Imported ${toImport.length} improvement${toImport.length !== 1 ? 's' : ''} ✓`, 'success');
}

// ─── Init CGT form ────────────────────────────────────────────
function initCGTForm() {
  const btn       = document.getElementById('btn-add-cgt');
  const panel     = document.getElementById('cgt-form-panel');
  const form      = document.getElementById('cgt-form');
  const cancel    = document.getElementById('btn-cancel-cgt');
  const submitBtn = document.getElementById('cgt-submit-btn');

  btn.addEventListener('click', () => openCGTForm(null, null));
  cancel.addEventListener('click', () => panel.classList.add('hidden'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let valid = true;
    const propSel = form.elements['property_id'];
    const amtIn   = form.elements['amount'];
    const propErr = form.querySelector('[data-field="cgt-property"]');
    const amtErr  = form.querySelector('[data-field="cgt-amount"]');

    if (!propSel.value) { propErr.classList.remove('hidden'); valid = false; }
    else propErr.classList.add('hidden');

    if (!amtIn.value || parseFloat(amtIn.value) <= 0) { amtErr.classList.remove('hidden'); valid = false; }
    else amtErr.classList.add('hidden');

    if (!valid) return;

    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const fd         = new FormData(form);
      const existingId = fd.get('id');
      const id         = existingId || generateId();
      const isNew      = !existingId;
      const record = {
        id,
        property_id:      fd.get('property_id'),
        category:         fd.get('category'),
        description:      fd.get('description'),
        amount:           parseFloat(fd.get('amount')),
        date:             fd.get('date'),
        notes:            fd.get('notes'),
        source_expense_id: '',
      };
      await dbPut('cgt', record);
      _sheetsWrite('CGT', isNew ? 'append' : 'update', record);
      panel.classList.add('hidden');
      form.reset();
      await renderCGT();
      showToast(`CGT entry ${isNew ? 'saved' : 'updated'} ✓`, 'success');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });
}

// ─── Properties screen ────────────────────────────────────────
async function renderPropertyList() {
  const el = document.getElementById('property-list');
  if (_properties.length === 0) {
    el.innerHTML = '<p class="empty-state">No properties added yet.</p>';
    return;
  }

  // Active/vacant first, sold last
  const sorted = [..._properties].sort((a, b) => {
    const order = { active: 0, vacant: 1, sold: 2 };
    return (order[a.status] ?? 0) - (order[b.status] ?? 0);
  });

  el.innerHTML = sorted.map(p => {
    const status = p.status || 'active';
    const statusLabel = { active: 'Active', vacant: 'Vacant', sold: 'Sold' }[status] || status;
    const metaParts = [];
    if (p.purchase_date) metaParts.push(`Purchased ${formatDate(p.purchase_date)}`);
    if (p.purchase_price) metaParts.push(formatGBP(p.purchase_price));
    if (p.ownership_pct != null && p.ownership_pct !== 100) metaParts.push(`${p.ownership_pct}% owned`);
    if (status === 'sold' && p.sale_date) metaParts.push(`Sold ${formatDate(p.sale_date)}`);

    return `
      <div class="property-card ${status === 'sold' ? 'sold' : ''}">
        <div class="property-card-info">
          <div class="property-card-name">${p.name}</div>
          ${p.address ? `<div class="property-card-address">${p.address.replace(/\n/g, ', ')}</div>` : ''}
          <div class="property-card-meta">
            <span class="property-status-badge ${status}">${statusLabel}</span>
            ${metaParts.join(' · ')}
          </div>
        </div>
        <div class="property-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit-prop="${p.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-delete-prop="${p.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-edit-prop]').forEach(btn => {
    btn.addEventListener('click', () => openPropertyForm(btn.dataset.editProp));
  });
  el.querySelectorAll('[data-delete-prop]').forEach(btn => {
    btn.addEventListener('click', () => deleteProperty(btn.dataset.deleteProp));
  });
}

function openPropertyForm(id) {
  const panel      = document.getElementById('property-form-panel');
  const form       = document.getElementById('property-form');
  const titleEl    = document.getElementById('property-form-title');
  const saleFields = document.getElementById('sale-fields');
  panel.classList.remove('hidden');
  form.reset();
  saleFields.classList.add('hidden');
  document.querySelectorAll('.field-error').forEach(e => e.classList.add('hidden'));

  if (id) {
    const p = _properties.find(x => x.id === id);
    if (p) {
      titleEl.textContent          = 'Edit Property';
      form.id.value                = p.id;
      form.name.value              = p.name;
      form.address.value           = p.address || '';
      form.status.value            = p.status || 'active';
      form.purchase_date.value     = p.purchase_date || '';
      form.purchase_price.value    = p.purchase_price || '';
      form.ownership_pct.value     = p.ownership_pct ?? 100;
      form.sale_date.value         = p.sale_date || '';
      form.sale_price.value        = p.sale_price || '';
      if ((p.status || 'active') === 'sold') saleFields.classList.remove('hidden');
    }
  } else {
    titleEl.textContent = 'Add Property';
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteProperty(id) {
  if (!confirm('Delete this property? All associated records will remain.')) return;
  await dbDelete('properties', id);
  _sheetsWrite('Properties', 'delete', null, id);
  _properties = _properties.filter(p => p.id !== id);
  populatePropertySelects();
  renderPropertyList();
  showToast('Property deleted', 'warn');
}

// ─── Form: income ─────────────────────────────────────────────
function initIncomeForm() {
  const btn       = document.getElementById('btn-add-income');
  const panel     = document.getElementById('income-form-panel');
  const form      = document.getElementById('income-form');
  const cancel    = document.getElementById('btn-cancel-income');
  const typeSel   = document.getElementById('income-type-select');
  const amtIn     = document.getElementById('income-amount');
  const depositNote = document.getElementById('deposit-note');
  const submitBtn = document.getElementById('income-submit-btn');

  btn.addEventListener('click', () => openIncomeForm(null));
  cancel.addEventListener('click', () => panel.classList.add('hidden'));

  // Show deposit note when type = Deposit received
  typeSel.addEventListener('change', () => {
    depositNote.classList.toggle('hidden', typeSel.value !== 'Deposit received');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Inline validation
    let valid = true;
    const propSel = form.elements['property_id'];
    const propErr = form.querySelector('[data-field="income-property"]');
    const amtErr  = form.querySelector('[data-field="income-amount"]');

    if (!propSel.value) { propErr.classList.remove('hidden'); valid = false; }
    else propErr.classList.add('hidden');

    if (!amtIn.value || parseFloat(amtIn.value) <= 0) { amtErr.classList.remove('hidden'); valid = false; }
    else amtErr.classList.add('hidden');

    if (!valid) return;

    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const fd         = new FormData(form);
      const existingId = fd.get('id');
      const id         = existingId || generateId();
      const isNew      = !existingId;
      const record = {
        id,
        property_id: fd.get('property_id'),
        date:        fd.get('date'),
        tax_year:    getTaxYear(fd.get('date')),
        amount:      parseFloat(fd.get('amount')),
        type:        fd.get('type'),
        tenant_ref:  fd.get('tenant_ref'),
        receipt_ref: fd.get('receipt_ref'),
        notes:       fd.get('notes'),
      };
      await dbPut('income', record);
      _sheetsWrite('Income', isNew ? 'append' : 'update', record);
      panel.classList.add('hidden');
      form.reset();
      depositNote.classList.add('hidden');
      await renderIncomeLedger();
      renderDashboard();
      showToast(`Income ${isNew ? 'saved' : 'updated'} ✓`, 'success');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });
}

// ─── Form: expense ────────────────────────────────────────────
function initExpenseForm() {
  const btn         = document.getElementById('btn-add-expense');
  const panel       = document.getElementById('expense-form-panel');
  const form        = document.getElementById('expense-form');
  const cancel      = document.getElementById('btn-cancel-expense');
  const catSel      = document.getElementById('expense-category-select');
  const mileRow     = document.getElementById('mileage-row');
  const milesIn     = document.getElementById('expense-miles');
  const mileTot     = document.getElementById('mileage-total');
  const amtIn       = document.getElementById('expense-amount');
  const cameraBtn   = document.getElementById('btn-camera');
  const cameraInput = document.getElementById('camera-input');
  const uploadStat  = document.getElementById('upload-status');
  const previewLink = document.getElementById('receipt-preview-link');
  const submitBtn   = document.getElementById('expense-submit-btn');

  btn.addEventListener('click', () => openExpenseForm(null));
  cancel.addEventListener('click', () => panel.classList.add('hidden'));

  // Show/hide mileage calculator based on category
  catSel.addEventListener('change', () => {
    const isMileage = catSel.value === 'Mileage';
    mileRow.classList.toggle('hidden', !isMileage);
    if (!isMileage) { milesIn.value = ''; mileTot.textContent = '£0.00'; }
  });

  // Mileage auto-calc — HMRC 45p/mile approved rate
  milesIn.addEventListener('input', () => {
    const total = (parseFloat(milesIn.value) || 0) * 0.45;
    mileTot.textContent = formatGBP(total);
    if (total > 0) amtIn.value = total.toFixed(2);
  });

  // Camera / file upload with progress
  cameraBtn.addEventListener('click', () => cameraInput.click());

  cameraInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    cameraBtn.disabled = true;
    uploadStat.textContent = 'Uploading…';
    uploadStat.classList.remove('hidden', 'upload-error');
    previewLink.classList.add('hidden');

    try {
      const stamp    = new Date().toISOString().slice(0, 10);
      const filename = `receipt-${stamp}-${file.name}`;
      const fileId   = await uploadReceipt(file, filename, (pct) => {
        uploadStat.textContent = `Uploading… ${pct}%`;
      });

      if (fileId) {
        document.getElementById('expense-receipt-ref').value = fileId;
        previewLink.href = getReceiptUrl(fileId);
        previewLink.classList.remove('hidden');
        uploadStat.textContent = '✓ Uploaded to Drive';
        setTimeout(() => uploadStat.classList.add('hidden'), 3000);
      } else {
        document.getElementById('expense-receipt-ref').value = file.name;
        uploadStat.textContent = 'Saved filename (Drive upload unavailable)';
      }
    } catch (err) {
      uploadStat.textContent = `Upload failed — ${err.message}`;
      uploadStat.classList.add('upload-error');
      document.getElementById('expense-receipt-ref').value = file.name;
    } finally {
      cameraBtn.disabled = false;
      cameraInput.value  = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Inline validation
    let valid = true;
    const propSel = form.elements['property_id'];
    const propErr = form.querySelector('[data-field="expense-property"]');
    const amtErr  = form.querySelector('[data-field="expense-amount"]');

    if (!propSel.value) { propErr.classList.remove('hidden'); valid = false; }
    else propErr.classList.add('hidden');

    if (!amtIn.value || parseFloat(amtIn.value) <= 0) { amtErr.classList.remove('hidden'); valid = false; }
    else amtErr.classList.add('hidden');

    if (!valid) return;

    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const fd         = new FormData(form);
      const existingId = fd.get('id');
      const id         = existingId || generateId();
      const isNew      = !existingId;
      const category   = fd.get('category');
      const record = {
        id,
        property_id: fd.get('property_id'),
        date:        fd.get('date'),
        tax_year:    getTaxYear(fd.get('date')),
        amount:      parseFloat(fd.get('amount')),
        category,
        supplier:    fd.get('supplier'),
        receipt_ref: fd.get('receipt_ref'),
        notes:       fd.get('notes'),
        is_capital:  category === 'Improvements' ? 1 : 0,
        status:      'active',
      };
      await dbPut('expenses', record);
      _sheetsWrite('Expenses', isNew ? 'append' : 'update', record);
      panel.classList.add('hidden');
      form.reset();
      await renderExpenseLedger();
      await renderReviewList();
      renderDashboard();
      showToast(`Expense ${isNew ? 'saved' : 'updated'} ✓`, 'success');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });
}

// ─── Form: property ───────────────────────────────────────────
function initPropertyForm() {
  const btn        = document.getElementById('btn-add-property');
  const panel      = document.getElementById('property-form-panel');
  const form       = document.getElementById('property-form');
  const cancel     = document.getElementById('btn-cancel-property');
  const statusSel  = document.getElementById('prop-status-select');
  const saleFields = document.getElementById('sale-fields');

  btn.addEventListener('click', () => openPropertyForm(null));

  cancel.addEventListener('click', () => panel.classList.add('hidden'));

  // Show/hide sale fields based on status
  statusSel.addEventListener('change', () => {
    saleFields.classList.toggle('hidden', statusSel.value !== 'sold');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Inline validation
    const nameInput = form.elements['name'];
    const nameError = form.querySelector('.field-error[data-field="name"]');
    if (!nameInput.value.trim()) {
      nameError.classList.remove('hidden');
      nameInput.focus();
      return;
    }
    nameError.classList.add('hidden');

    const fd = new FormData(form);
    const existingId = fd.get('id');
    const id = existingId || generateId();
    const isNew = !existingId;
    const status = fd.get('status') || 'active';
    const record = {
      id,
      name:           fd.get('name').trim(),
      address:        fd.get('address').trim(),
      status,
      purchase_date:  fd.get('purchase_date'),
      purchase_price: fd.get('purchase_price') ? parseFloat(fd.get('purchase_price')) : '',
      ownership_pct:  fd.get('ownership_pct') ? parseFloat(fd.get('ownership_pct')) : 100,
      sale_date:      status === 'sold' ? (fd.get('sale_date') || '') : '',
      sale_price:     status === 'sold' && fd.get('sale_price') ? parseFloat(fd.get('sale_price')) : '',
    };
    await dbPut('properties', record);
    _sheetsWrite('Properties', isNew ? 'append' : 'update', record);
    const idx = _properties.findIndex(p => p.id === id);
    if (idx >= 0) _properties[idx] = record;
    else _properties.push(record);
    panel.classList.add('hidden');
    form.reset();
    populatePropertySelects();
    await renderPropertyList();
    showToast(`Property ${isNew ? 'added' : 'updated'} ✓`, 'success');
  });
}

// ─── Export / import ─────────────────────────────────────────
async function exportJSON() {
  const [properties, income, expenses, cgt, gmailScan] = await Promise.all([
    dbGetAll('properties'),
    dbGetAll('income'),
    dbGetAll('expenses'),
    dbGetAll('cgt'),
    dbGetAll('gmailScan'),
  ]);
  const data = { properties, income, expenses, cgt, gmailScan, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `property-tracker-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported: ${properties.length} properties, ${income.length} income, ${expenses.length} expenses ✓`, 'success', 4000);
}

async function importJSON(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.properties && !data.income && !data.expenses) {
      showToast('Import failed — not a valid backup file', 'error');
      return;
    }
    const stores = ['properties', 'income', 'expenses', 'cgt', 'gmailScan'];
    let counts = {};
    for (const store of stores) {
      if (Array.isArray(data[store])) {
        for (const record of data[store]) { await dbPut(store, record); }
        counts[store] = data[store].length;
      }
    }
    _properties = await dbGetAll('properties');
    populatePropertySelects();
    await Promise.all([renderPropertyList(), renderDashboard(), renderIncomeLedger(), renderExpenseLedger(), renderReviewList(), renderCGT()]);
    const summary = `${counts.properties ?? 0} properties · ${counts.income ?? 0} income · ${counts.expenses ?? 0} expenses`;
    showToast(`Import complete ✓ — ${summary}`, 'success', 5000);
  } catch (err) {
    showToast('Import failed — invalid JSON', 'error');
  }
}

// ─── Gmail results ────────────────────────────────────────────
async function renderGmailResults(results) {
  const el = document.getElementById('gmail-results');
  if (!results || results.length === 0) {
    el.innerHTML = '<p class="empty-state">No new receipts found. Try a wider date range or different keywords.</p>';
    await _renderGmailHistory();
    return;
  }

  const propOptions = _properties.map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join('');

  el.innerHTML = `
    <div class="gmail-results-count">${results.length} new item${results.length !== 1 ? 's' : ''} found</div>
    ${results.map(r => `
      <div class="gmail-result-item" data-msg-id="${r.gmail_message_id}">
        <div class="gmail-result-subject">${escHtml(r.subject)}</div>
        <div class="gmail-result-meta">
          <span class="gmail-result-supplier">${escHtml(r.suggested_supplier || 'Unknown sender')}</span>
          <span class="gmail-result-dot">·</span>
          <span>${formatDate(r.date)}</span>
        </div>
        ${r.suggested_amount ? `<div class="gmail-result-amount">${formatGBP(r.suggested_amount)}</div>` : '<div class="gmail-result-amount gmail-result-amount--none">No amount found</div>'}
        ${r.body_preview ? `<div class="gmail-result-preview">${escHtml(r.body_preview.slice(0, 180))}…</div>` : ''}
        <div class="gmail-approve-row">
          <select class="gmail-property-select" data-for="${r.gmail_message_id}">
            <option value="">— Assign property (optional) —</option>
            ${propOptions}
          </select>
        </div>
        <div class="gmail-result-actions">
          <button class="btn btn-primary btn-sm" data-approve="${r.gmail_message_id}">Approve as expense</button>
          <button class="btn btn-ghost btn-sm" data-dismiss="${r.gmail_message_id}">Dismiss</button>
        </div>
      </div>
    `).join('')}
  `;

  el.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const msgId      = btn.dataset.approve;
      const item       = results.find(r => r.gmail_message_id === msgId);
      if (!item) return;

      const propSel    = el.querySelector(`select[data-for="${msgId}"]`);
      const propertyId = propSel?.value || '';

      btn.disabled     = true;
      btn.textContent  = 'Saving…';

      const expenseId = generateId();
      const expense = {
        id:          expenseId,
        property_id: propertyId,
        date:        item.date,
        tax_year:    getTaxYear(item.date),
        amount:      item.suggested_amount || 0,
        category:    'Uncategorised',
        supplier:    item.suggested_supplier || '',
        receipt_ref: '',
        notes:       item.subject,
        is_capital:  0,
        status:      'active',
      };
      await dbPut('expenses', expense);
      _sheetsWrite('Expenses', 'append', expense);

      const scanRecord = {
        id:                 generateId(),
        gmail_message_id:   msgId,
        date:               item.date,
        subject:            item.subject,
        suggested_supplier: item.suggested_supplier || '',
        suggested_amount:   item.suggested_amount || 0,
        status:             'approved',
        linked_expense_id:  expenseId,
      };
      await dbPut('gmailScan', scanRecord);
      _sheetsWrite('GmailScan', 'append', scanRecord);

      const card = btn.closest('.gmail-result-item');
      card.classList.add('gmail-result-item--done');
      setTimeout(() => card.remove(), 400);

      await Promise.all([renderReviewList(), renderExpenseLedger()]);
      showToast('Added as Uncategorised expense ✓', 'success');
    });
  });

  el.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.dismiss;
      const item  = results.find(r => r.gmail_message_id === msgId);

      const scanRecord = {
        id:                 generateId(),
        gmail_message_id:   msgId,
        date:               item?.date     || '',
        subject:            item?.subject  || '',
        suggested_supplier: item?.suggested_supplier || '',
        suggested_amount:   item?.suggested_amount || 0,
        status:             'dismissed',
        linked_expense_id:  '',
      };
      await dbPut('gmailScan', scanRecord);
      _sheetsWrite('GmailScan', 'append', scanRecord);

      const card = btn.closest('.gmail-result-item');
      card.classList.add('gmail-result-item--done');
      setTimeout(() => card.remove(), 400);
    });
  });

  await _renderGmailHistory();
}

// ─── Gmail history (previously reviewed items) ────────────────
async function _renderGmailHistory() {
  const all = await dbGetAll('gmailScan');
  const reviewed = all.filter(r => r.status === 'approved' || r.status === 'dismissed');
  reviewed.sort((a, b) => b.date.localeCompare(a.date));

  const headerEl  = document.getElementById('gmail-history-header');
  const historyEl = document.getElementById('gmail-history');
  if (!headerEl || !historyEl) return;

  if (reviewed.length === 0) {
    headerEl.style.display = 'none';
    historyEl.style.display = 'none';
    return;
  }

  headerEl.style.display = 'flex';
  const toggleBtn = document.getElementById('btn-toggle-history');
  const isOpen    = historyEl.style.display !== 'none' && historyEl.innerHTML.trim() !== '';

  historyEl.innerHTML = reviewed.slice(0, 50).map(r => `
    <div class="gmail-history-item gmail-history-item--${r.status}">
      <div class="gmail-history-badge gmail-history-badge--${r.status}">${r.status === 'approved' ? 'Approved' : 'Dismissed'}</div>
      <div class="gmail-result-subject">${escHtml(r.subject)}</div>
      <div class="gmail-result-meta">
        ${r.suggested_supplier ? escHtml(r.suggested_supplier) + ' · ' : ''}${formatDate(r.date)}
        ${r.suggested_amount ? ' · ' + formatGBP(Number(r.suggested_amount)) : ''}
      </div>
    </div>
  `).join('');

  if (!isOpen) {
    historyEl.style.display = 'none';
    if (toggleBtn) toggleBtn.textContent = `Show (${reviewed.length})`;
  } else {
    if (toggleBtn) toggleBtn.textContent = 'Hide';
  }
}

// ─── Screen helpers ───────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').classList.remove('active');
}

function showAppScreen() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
}

// ─── Sheets write-through helper ─────────────────────────────
// action: 'append' | 'update' | 'delete'
async function _sheetsWrite(tabName, action, record, id) {
  if (!isAuthenticated()) return;
  try {
    setSyncStatus('pending', 'Syncing…');
    if (action === 'append') {
      await sheetsAppend(tabName, record);
    } else if (action === 'update') {
      await sheetsUpdate(tabName, record);
    } else if (action === 'delete') {
      await sheetsDeleteRow(tabName, id);
    }
    setSyncStatus('synced', 'Synced');
  } catch (err) {
    console.warn(`_sheetsWrite(${tabName}, ${action}) failed:`, err.message);
    setSyncStatus('error', 'Sync error');
    await queueOperation({ tabName, action, record, id, ts: Date.now() }).catch(() => {});
    _updateSyncBadge();
  }
}

// ─── Load all app data and renders after auth ─────────────────
async function loadAppData() {
  try {
    await sheetsInit();
    await syncFromSheets();
  } catch (err) {
    console.warn('Sheets init/sync failed:', err.message);
  }
  await loadProperties();
  populateTaxYearSelects();
  await Promise.all([
    renderDashboard(),
    renderIncomeLedger(),
    renderExpenseLedger(),
    renderReviewList(),
    renderCGT(),
    renderPropertyList(),
  ]);
  // Flush any ops that were queued while offline
  processQueue();
  _updateSyncBadge();
}

// ─── Sign-in handler ──────────────────────────────────────────
async function handleSignIn() {
  const btn = document.getElementById('btn-signin');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await signIn();
    showAppScreen();
    await loadAppData();
  } catch (err) {
    const errEl = document.getElementById('login-error');
    if (errEl && err.message !== 'sign_in_cancelled') {
      errEl.textContent = 'Sign in failed — ' + err.message;
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 6000);
    }
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// ─── Sign-out handler ─────────────────────────────────────────
function handleSignOut() {
  signOut();
  showLoginScreen();
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  if (window.__configMissing) {
    console.warn('config.js not found — copy config.example.js to config.js and fill in your credentials');
  }

  // Apply OS-specific class when running inside Electron
  if (window.electronApp) {
    document.body.classList.add('electron', `electron-${window.electronApp.platform}`);
  }

  initSync();

  // Wire sign-in / sign-out
  document.getElementById('btn-signin')?.addEventListener('click', handleSignIn);
  document.getElementById('btn-signout')?.addEventListener('click', handleSignOut);

  // Nav routing
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Dashboard filters
  document.getElementById('dash-filter-property')?.addEventListener('change', renderDashboard);
  document.getElementById('dash-filter-year')?.addEventListener('change', renderDashboard);

  // Dashboard — uncategorised alert link
  document.getElementById('dash-uncat-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('review');
  });

  // Review filters / sort
  document.getElementById('review-filter-property')?.addEventListener('change', renderReviewList);
  document.getElementById('review-sort')?.addEventListener('change', renderReviewList);

  // Income filters
  document.getElementById('income-filter-property')?.addEventListener('change', renderIncomeLedger);
  document.getElementById('income-filter-year')?.addEventListener('change', renderIncomeLedger);
  document.getElementById('income-filter-type')?.addEventListener('change', renderIncomeLedger);

  // Expense filters
  document.getElementById('expense-filter-property')?.addEventListener('change', renderExpenseLedger);
  document.getElementById('expense-filter-year')?.addEventListener('change', renderExpenseLedger);
  document.getElementById('expense-filter-category')?.addEventListener('change', renderExpenseLedger);

  // Forms
  initIncomeForm();
  initExpenseForm();
  initPropertyForm();
  initCGTForm();

  // Export / import
  document.getElementById('btn-export')?.addEventListener('click', exportJSON);
  const importBtn   = document.getElementById('btn-import');
  const importInput = document.getElementById('import-input');
  importBtn?.addEventListener('click', () => importInput.click());
  importInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
  });

  // Gmail scan controls — segment buttons for date range
  document.getElementById('gmail-days-group')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    document.querySelectorAll('#gmail-days-group .segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Gmail scan button
  document.getElementById('btn-scan-gmail')?.addEventListener('click', async () => {
    const btn        = document.getElementById('btn-scan-gmail');
    const statusEl   = document.getElementById('gmail-scan-status');
    const activeDay  = document.querySelector('#gmail-days-group .segment-btn.active');
    const days       = activeDay ? parseInt(activeDay.dataset.days, 10) : 60;
    const customQ    = (document.getElementById('gmail-custom-query')?.value || '').trim();

    btn.disabled    = true;
    btn.textContent = 'Scanning…';
    if (statusEl) { statusEl.textContent = 'Searching Gmail…'; statusEl.className = 'gmail-scan-status'; }

    try {
      const results = await scanGmail({ days, query: customQ });
      if (statusEl) {
        statusEl.textContent = results.length
          ? `Found ${results.length} new item${results.length !== 1 ? 's' : ''}`
          : 'No new items found';
        statusEl.className = 'gmail-scan-status gmail-scan-status--done';
      }
      await renderGmailResults(results);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Scan failed — ' + err.message; statusEl.className = 'gmail-scan-status gmail-scan-status--error'; }
      console.error('Gmail scan error:', err);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Scan Inbox';
    }
  });

  // Gmail history toggle
  document.getElementById('btn-toggle-history')?.addEventListener('click', () => {
    const el     = document.getElementById('gmail-history');
    const btn    = document.getElementById('btn-toggle-history');
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'flex';
    btn.textContent  = isOpen ? `Show` : 'Hide';
    if (!isOpen) _renderGmailHistory();
  });

  // Offline banner
  const banner = document.getElementById('offline-banner');
  window.addEventListener('online',  () => banner.classList.add('hidden'));
  window.addEventListener('offline', () => banner.classList.remove('hidden'));
  if (!navigator.onLine) banner.classList.remove('hidden');

  // SW → app: background sync trigger
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data === 'process-queue') processQueue();
  });

  // Show checking state while auth resolves
  const signinBtn = document.getElementById('btn-signin');
  if (signinBtn) { signinBtn.disabled = true; signinBtn.textContent = 'Checking…'; }

  const authed = await initAuth();

  if (authed) {
    showAppScreen();
    await loadAppData();
  } else {
    // Restore sign-in button
    if (signinBtn) {
      signinBtn.disabled = false;
      signinBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.1-2.7-.4-4z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.7-2.8-11.4-7.2l-6.5 5C9.5 39.7 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6l6.2 5.2C40.1 36.1 44 30.6 44 24c0-1.3-.1-2.7-.4-4z"/>
        </svg>
        Sign in with Google`;
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
