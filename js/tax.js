// UK tax year: 6 April to 5 April
// Returns "YYYY/YY" e.g. "2024/25"
function getTaxYear(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const day = d.getDate();
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  const endYear = (startYear + 1).toString().slice(2);
  return `${startYear}/${endYear}`;
}

// Returns all tax years from 2018/19 to current + 1
function getTaxYearList() {
  const now = new Date();
  const currentTY = getTaxYear(now.toISOString().slice(0, 10));
  const [startYear] = currentTY.split('/').map(Number);
  const years = [];
  for (let y = 2018; y <= startYear + 1; y++) {
    const end = (y + 1).toString().slice(2);
    years.push(`${y}/${end}`);
  }
  return years.reverse();
}

// Mortgage interest tax credit = 20% of mortgage interest paid
function mortgageTaxCredit(mortgageInterestTotal) {
  return mortgageInterestTotal * 0.20;
}

// Categorise an expense category string
const REVENUE_CATEGORIES = new Set([
  'Insurance',
  'Letting agent / advertising',
  'Repairs & maintenance',
  'Utilities',
  'Professional fees',
  'Replacement furnishings',
  'Mileage',
  'Other allowable',
]);

const MORTGAGE_CATEGORY = 'Mortgage interest';
const CAPITAL_CATEGORY  = 'Improvements';
const UNCATEGORISED     = 'Uncategorised';

function expenseType(category) {
  if (category === UNCATEGORISED)          return 'uncategorised';
  if (category === MORTGAGE_CATEGORY)      return 'mortgage';
  if (category === CAPITAL_CATEGORY)       return 'capital';
  if (category === 'Personal / non-allowable') return 'non-allowable';
  if (REVENUE_CATEGORIES.has(category))   return 'revenue';
  return 'uncategorised';
}

// CGT categories
const CGT_CATEGORIES = [
  'Purchase price',
  'Stamp duty (SDLT)',
  'Legal fees (purchase)',
  'Mortgage arrangement fee',
  'Survey fees',
  'Initial furnishings (new let)',
  'Capital improvement',
  'Legal fees (sale)',
  'Other acquisition cost',
];
