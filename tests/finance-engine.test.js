// ============================================================
// Finance Engine — Unit Tests
// Run: node tests/finance-engine.test.js
// ============================================================

// Simulate browser globals so the IIFE in finance-engine.js works
global.window = {};

// Load the module
require('../js/finance-engine.js');

const engine = global.window.financeEngine;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function assertEq(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, tolerance, name) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}\n    expected: ~${expected} (±${tolerance})\n    actual:   ${actual}`);
  }
}

// ── Seed data (mirrors the SQL migration) ─────────────────────
const RULES = [
  { priority: 100, match_field: 'tx_type', match_op: 'equals', match_value: 'Currency exchange', set_category: 'fx_sweep', set_internal: true, active: true },
  { priority: 300, match_field: 'counterparty', match_op: 'contains', match_value: 'pellegrino bozzella', set_category: 'owner_draw', set_internal: false, active: true },
  { priority: 400, match_field: 'counterparty', match_op: 'contains', match_value: 'maria mercedes claps', set_category: 'salary', set_internal: false, active: true },
  { priority: 401, match_field: 'counterparty', match_op: 'contains', match_value: 'ayoub rafia', set_category: 'salary', set_internal: false, active: true },
  { priority: 500, match_field: 'counterparty', match_op: 'contains', match_value: 'ifza', set_category: 'cogs', set_internal: false, active: true },
  { priority: 501, match_field: 'counterparty', match_op: 'contains', match_value: 'the vat consultant', set_category: 'cogs', set_internal: false, active: true },
  { priority: 502, match_field: 'counterparty', match_op: 'contains', match_value: 'vat consultant', set_category: 'cogs', set_internal: false, active: true },
  { priority: 503, match_field: 'counterparty', match_op: 'contains', match_value: 'al nadra', set_category: 'cogs', set_internal: false, active: true },
  { priority: 504, match_field: 'counterparty', match_op: 'contains', match_value: 'freezoner', set_category: 'cogs', set_internal: false, active: true },
  { priority: 505, match_field: 'counterparty', match_op: 'contains', match_value: 'trivup', set_category: 'cogs', set_internal: false, active: true },
  { priority: 506, match_field: 'counterparty', match_op: 'contains', match_value: 'affinitas', set_category: 'cogs', set_internal: false, active: true },
  { priority: 507, match_field: 'counterparty', match_op: 'contains', match_value: 'roll04', set_category: 'cogs', set_internal: false, active: true },
  { priority: 508, match_field: 'counterparty', match_op: 'contains', match_value: 'vitals', set_category: 'cogs', set_internal: false, active: true },
  { priority: 509, match_field: 'counterparty', match_op: 'contains', match_value: 'sobusiness', set_category: 'cogs', set_internal: false, active: true },
  { priority: 510, match_field: 'counterparty', match_op: 'contains', match_value: 'zama', set_category: 'cogs', set_internal: false, active: true },
  { priority: 511, match_field: 'counterparty', match_op: 'contains', match_value: 'digital offerte', set_category: 'cogs', set_internal: false, active: true },
  { priority: 512, match_field: 'counterparty', match_op: 'contains', match_value: 'giuseppe muscetti', set_category: 'cogs', set_internal: false, active: true },
  { priority: 513, match_field: 'counterparty', match_op: 'contains', match_value: 'leo srl', set_category: 'cogs', set_internal: false, active: true },
  { priority: 514, match_field: 'counterparty', match_op: 'contains', match_value: 'oasis', set_category: 'cogs', set_internal: false, active: true },
  { priority: 600, match_field: 'description', match_op: 'contains', match_value: 'credit repayment', set_category: 'debt_repayment', set_internal: false, active: true },
  { priority: 601, match_field: 'description', match_op: 'contains', match_value: 'autopay', set_category: 'debt_repayment', set_internal: false, active: true },
  { priority: 700, match_field: 'tx_type', match_op: 'equals', match_value: 'Fees', set_category: 'fees', set_internal: false, active: true },
];

const INTERNAL_PARTIES = [
  { name_pattern: 'sara tufo', note: 'moglie' },
];


// ════════════════════════════════════════════════════════════════
// 1. CSV PARSER TESTS
// ════════════════════════════════════════════════════════════════
console.log('\n=== CSV Parser Tests ===');

// 1a. parseCsvLine basics
{
  const r = engine.parseCsvLine('a,b,c');
  assertEq(r.length, 3, 'parseCsvLine: simple 3 fields');
  assertEq(r[0], 'a', 'parseCsvLine: first field');
  assertEq(r[2], 'c', 'parseCsvLine: last field');
}

// 1b. parseCsvLine with quoted fields
{
  const r = engine.parseCsvLine('"hello, world",b,"c""d"');
  assertEq(r.length, 3, 'parseCsvLine: quoted fields count');
  assertEq(r[0], 'hello, world', 'parseCsvLine: comma inside quotes');
  assertEq(r[2], 'c"d', 'parseCsvLine: escaped quote');
}

// 1c. parseCsvLine empty fields
{
  const r = engine.parseCsvLine('a,,c,');
  assertEq(r.length, 4, 'parseCsvLine: empty fields count');
  assertEq(r[1], '', 'parseCsvLine: empty middle field');
  assertEq(r[3], '', 'parseCsvLine: empty trailing field');
}

// 1d. Full Wio CSV parsing
{
  const csv = `Account name,Account currency,Transaction type,Date,Ref. number,Description,Amount,Balance,Notes
Full Digital FZCO,AED,Transfers,15/01/2025,TRF001,"From Acme Corp - Invoice 123",50000,150000,
Full Digital FZCO,AED,Transfers,16/01/2025,TRF002,"To IFZA - License fee",-12000,138000,
Full Digital FZCO,AED,Currency exchange,17/01/2025,FX001,"Currency exchange EUR to AED",-5000,133000,
Full Digital FZCO,AED,Fees,18/01/2025,FEE001,"Monthly account fee",-100,132900,`;

  const txns = engine.parseWioCsv(csv);
  assertEq(txns.length, 4, 'parseWioCsv: 4 transactions parsed');
  assertEq(txns[0].txnDate, '2025-01-15', 'parseWioCsv: date DD/MM/YYYY → YYYY-MM-DD');
  assertEq(txns[0].amount, 50000, 'parseWioCsv: positive amount');
  assertEq(txns[0].counterparty, 'Acme Corp', 'parseWioCsv: counterparty from "From X"');
  assertEq(txns[0].refNumber, 'TRF001', 'parseWioCsv: ref number');
  assertEq(txns[0].currency, 'AED', 'parseWioCsv: currency');
  assertEq(txns[1].amount, -12000, 'parseWioCsv: negative amount');
  assertEq(txns[1].counterparty, 'IFZA', 'parseWioCsv: counterparty from "To X"');
  assertEq(txns[2].txType, 'Currency exchange', 'parseWioCsv: tx_type preserved');
  assertEq(txns[3].txType, 'Fees', 'parseWioCsv: fees tx_type');
}

// 1e. Wio CSV with amounts containing commas
{
  const csv = `Account name,Account currency,Transaction type,Date,Ref. number,Description,Amount,Balance,Notes
Full Digital FZCO,AED,Transfers,01/02/2025,TRF010,"From Client X","1,500,000",2000000,`;

  const txns = engine.parseWioCsv(csv);
  assertEq(txns.length, 1, 'parseWioCsv: parsed row with comma amount');
  assertEq(txns[0].amount, 1500000, 'parseWioCsv: comma-formatted amount parsed correctly');
}

// 1f. Empty / minimal CSV
{
  assertEq(engine.parseWioCsv('').length, 0, 'parseWioCsv: empty string → 0');
  assertEq(engine.parseWioCsv('header1,header2').length, 0, 'parseWioCsv: headers only → 0');
}

// 1g. Date parsing formats
{
  const csv = `Account name,Account currency,Transaction type,Date,Ref. number,Description,Amount,Balance,Notes
Test,AED,Transfers,2025-03-15,R1,Test,100,100,
Test,AED,Transfers,15-03-2025,R2,Test,200,200,
Test,AED,Transfers,15/03/2025,R3,Test,300,300,`;

  const txns = engine.parseWioCsv(csv);
  assertEq(txns.length, 3, 'parseWioCsv: 3 date formats parsed');
  assertEq(txns[0].txnDate, '2025-03-15', 'parseWioCsv: YYYY-MM-DD format');
  assertEq(txns[1].txnDate, '2025-03-15', 'parseWioCsv: DD-MM-YYYY format');
  assertEq(txns[2].txnDate, '2025-03-15', 'parseWioCsv: DD/MM/YYYY format');
}


// ════════════════════════════════════════════════════════════════
// 2. CLASSIFICATION ENGINE TESTS — all 9 cases
// ════════════════════════════════════════════════════════════════
console.log('\n=== Classification Engine Tests ===');

// Helper to classify a single txn
function classify(txn) {
  return engine.classifyTransactions([txn], RULES, INTERNAL_PARTIES)[0];
}

// Case 1: FX sweep (Currency exchange) → is_internal=true, category=fx_sweep
{
  const t = classify({ txType: 'Currency exchange', amount: -5000, counterparty: 'Internal', description: 'EUR to AED' });
  assertEq(t.category, 'fx_sweep', 'classify: FX sweep → fx_sweep');
  assertEq(t.is_internal, true, 'classify: FX sweep → is_internal');
}

// Case 2: Internal party (Sara Tufo) → round_trip, is_internal
{
  const t = classify({ counterparty: 'Sara Tufo', amount: -15000, txType: 'Transfers', description: 'Salary payment' });
  assertEq(t.category, 'round_trip', 'classify: Sara Tufo → round_trip');
  assertEq(t.is_internal, true, 'classify: Sara Tufo → is_internal');
}

// Case 2b: Internal party case-insensitive
{
  const t = classify({ counterparty: 'SARA TUFO', amount: -15000, txType: 'Transfers', description: 'Salary' });
  assertEq(t.category, 'round_trip', 'classify: SARA TUFO uppercase → round_trip');
}

// Case 2c: Internal party takes priority over salary rules
{
  const t = classify({ counterparty: 'Sara Tufo Consulting', amount: 10000, txType: 'Transfers', description: 'Invoice' });
  assertEq(t.category, 'round_trip', 'classify: Sara Tufo partial match → round_trip (not revenue)');
}

// Case 3: Owner draw (Pellegrino Bozzella)
{
  const t = classify({ counterparty: 'Pellegrino Bozzella', amount: -50000, txType: 'Transfers', description: 'Owner withdrawal' });
  assertEq(t.category, 'owner_draw', 'classify: Pellegrino Bozzella → owner_draw');
  assertEq(t.is_internal, false, 'classify: owner_draw is NOT internal');
}

// Case 3b: Owner draw case-insensitive
{
  const t = classify({ counterparty: 'PELLEGRINO BOZZELLA', amount: -30000, txType: 'Transfers', description: 'Monthly' });
  assertEq(t.category, 'owner_draw', 'classify: PELLEGRINO BOZZELLA uppercase → owner_draw');
}

// Case 4: Staff salaries
{
  const t1 = classify({ counterparty: 'Maria Mercedes Claps', amount: -8000, txType: 'Transfers', description: 'Salary' });
  assertEq(t1.category, 'salary', 'classify: Maria Mercedes Claps → salary');

  const t2 = classify({ counterparty: 'Ayoub Rafia', amount: -6000, txType: 'Transfers', description: 'Salary' });
  assertEq(t2.category, 'salary', 'classify: Ayoub Rafia → salary');
}

// Case 5: COGS — all providers
{
  const cogsProviders = [
    'IFZA Free Zone', 'The Vat Consultant LLC', 'Al Nadra Services',
    'Freezoner FZ-LLC', 'TRIVUP SRL', 'Affinitas Group',
    'Roll04 Media', 'Vitals Health', 'SoBusiness Solutions',
    'Zama Digital', 'Digital Offerte SRL', 'Giuseppe Muscetti',
    'LEO SRL', 'Oasis Business Centre',
  ];
  cogsProviders.forEach(cp => {
    const t = classify({ counterparty: cp, amount: -5000, txType: 'Transfers', description: 'Service payment' });
    assertEq(t.category, 'cogs', `classify: ${cp} → cogs`);
  });
}

// Case 6: Debt repayment
{
  const t1 = classify({ counterparty: 'Bank', amount: -2000, txType: 'Transfers', description: 'Credit Repayment - Loan 123' });
  assertEq(t1.category, 'debt_repayment', 'classify: Credit Repayment → debt_repayment');

  const t2 = classify({ counterparty: 'Bank', amount: -1500, txType: 'Transfers', description: 'Autopay monthly installment' });
  assertEq(t2.category, 'debt_repayment', 'classify: Autopay → debt_repayment');
}

// Case 7: Fees
{
  const t = classify({ counterparty: '', amount: -50, txType: 'Fees', description: 'Monthly maintenance fee' });
  assertEq(t.category, 'fees', 'classify: Fees tx_type → fees');
}

// Case 8: Revenue (positive transfer)
{
  const t = classify({ counterparty: 'Random Client LLC', amount: 25000, txType: 'Transfers', description: 'Invoice payment' });
  assertEq(t.category, 'revenue', 'classify: positive Transfers → revenue');
  assertEq(t.is_internal, false, 'classify: revenue → not internal');
}

// Case 8b: Revenue with empty txType
{
  const t = classify({ counterparty: 'Client XYZ', amount: 10000, txType: '', description: 'Payment' });
  assertEq(t.category, 'revenue', 'classify: positive with empty txType → revenue');
}

// Case 8c: Revenue with Cheque type
{
  const t = classify({ counterparty: 'Client', amount: 5000, txType: 'Cheque', description: 'Cheque deposit' });
  assertEq(t.category, 'revenue', 'classify: positive Cheque → revenue');
}

// Case 9: Fallback (negative, unknown)
{
  const t = classify({ counterparty: 'Unknown Company', amount: -500, txType: 'Card', description: 'Random purchase' });
  assertEq(t.category, 'other', 'classify: unknown negative → other');
  assertEq(t.is_internal, false, 'classify: other → not internal');
}

// Category locked — don't override
{
  const t = classify({ counterparty: 'IFZA', amount: -5000, txType: 'Transfers', description: 'Test', category: 'revenue', category_locked: true });
  assertEq(t.category, 'revenue', 'classify: category_locked → unchanged');
}

// Disabled rule should not match
{
  const disabledRules = RULES.map(r => ({ ...r, active: r.match_value === 'ifza' ? false : r.active }));
  const t = engine.classifyTransactions(
    [{ counterparty: 'IFZA Free Zone', amount: -5000, txType: 'Transfers', description: 'Payment' }],
    disabledRules,
    INTERNAL_PARTIES
  )[0];
  assertEq(t.category, 'other', 'classify: disabled IFZA rule → falls through to other');
}

// Priority ordering — FX sweep beats everything else
{
  const t = classify({ counterparty: 'Pellegrino Bozzella', amount: -5000, txType: 'Currency exchange', description: 'FX swap' });
  assertEq(t.category, 'fx_sweep', 'classify: FX sweep priority beats owner_draw');
  assertEq(t.is_internal, true, 'classify: FX sweep is_internal=true even if owner');
}

// Internal party beats owner draw (Sara sending to Pellegrino scenario)
{
  const t = classify({ counterparty: 'Sara Tufo', amount: -15000, txType: 'Transfers', description: 'To Pellegrino Bozzella' });
  assertEq(t.category, 'round_trip', 'classify: internal party priority beats description containing owner name');
}


// ════════════════════════════════════════════════════════════════
// 3. matchRule TESTS
// ════════════════════════════════════════════════════════════════
console.log('\n=== matchRule Tests ===');

{
  const r = { match_field: 'counterparty', match_op: 'contains', match_value: 'ifza' };
  assert(engine.matchRule({ counterparty: 'IFZA Free Zone' }, r), 'matchRule: contains case-insensitive');
  assert(!engine.matchRule({ counterparty: 'Some Other Corp' }, r), 'matchRule: contains no match');
}

{
  const r = { match_field: 'tx_type', match_op: 'equals', match_value: 'Fees' };
  assert(engine.matchRule({ txType: 'Fees' }, r), 'matchRule: equals match');
  assert(engine.matchRule({ txType: 'fees' }, r), 'matchRule: equals case-insensitive');
  assert(!engine.matchRule({ txType: 'Fee' }, r), 'matchRule: equals partial no match');
}

{
  const r = { match_field: 'description', match_op: 'regex', match_value: 'invoice\\s+\\d+' };
  assert(engine.matchRule({ description: 'Payment for Invoice 123' }, r), 'matchRule: regex match');
  assert(!engine.matchRule({ description: 'Payment for services' }, r), 'matchRule: regex no match');
}

{
  const r = { match_field: 'description', match_op: 'regex', match_value: '[invalid(' };
  assert(!engine.matchRule({ description: 'test' }, r), 'matchRule: invalid regex → false (no crash)');
}

{
  const r = { match_field: 'counterparty', match_op: 'unknown_op', match_value: 'test' };
  assert(!engine.matchRule({ counterparty: 'test' }, r), 'matchRule: unknown operator → false');
}


// ════════════════════════════════════════════════════════════════
// 4. AGGREGATION TESTS
// ════════════════════════════════════════════════════════════════
console.log('\n=== Aggregation Tests ===');

{
  const txns = [
    { txn_date: '2025-01-05', amount: 100000, amount_aed: 100000, category: 'revenue', is_internal: false },
    { txn_date: '2025-01-10', amount: -30000, amount_aed: -30000, category: 'cogs', is_internal: false },
    { txn_date: '2025-01-12', amount: -15000, amount_aed: -15000, category: 'salary', is_internal: false },
    { txn_date: '2025-01-15', amount: -2000, amount_aed: -2000, category: 'fees', is_internal: false },
    { txn_date: '2025-01-20', amount: -50000, amount_aed: -50000, category: 'owner_draw', is_internal: false },
    { txn_date: '2025-01-22', amount: -5000, amount_aed: -5000, category: 'fx_sweep', is_internal: true },
    { txn_date: '2025-01-25', amount: -15000, amount_aed: -15000, category: 'round_trip', is_internal: true },
  ];

  const result = engine.aggregateMonthly(txns, 30000);
  assertEq(result.length, 1, 'aggregate: 1 month');

  const m = result[0];
  assertEq(m.month, '2025-01', 'aggregate: correct month');
  assertEq(m.revenue, 100000, 'aggregate: revenue 100K');
  assertEq(m.cogs, 30000, 'aggregate: cogs 30K');
  assertEq(m.salaries, 15000, 'aggregate: salaries 15K');
  assertEq(m.fees, 2000, 'aggregate: fees 2K');
  assertEq(m.owner_draw, 50000, 'aggregate: owner_draw 50K');

  // operating_cash = 100K - 30K - 15K - 0 - 2K - 0 = 53K
  assertEq(m.operating_cash, 53000, 'aggregate: operating_cash = revenue - cogs - salaries - debt - fees - other');

  // real_surplus = 53K - 30K = 23K
  assertEq(m.real_surplus, 23000, 'aggregate: real_surplus = operating_cash - owner_base');

  // owner_allowance = max(50K - 30K, 0) = 20K
  assertEq(m.owner_allowance, 20000, 'aggregate: owner_allowance = max(owner_draw - base, 0)');

  // net_flow = 53K - 50K = 3K
  assertEq(m.net_flow, 3000, 'aggregate: net_flow = operating_cash - owner_draw_total');

  // cogs_pct = 30K / 100K = 0.3
  assertClose(m.cogs_pct, 0.3, 0.001, 'aggregate: cogs_pct = cogs / revenue');
}

// Internal transactions excluded
{
  const txns = [
    { txn_date: '2025-02-01', amount: 50000, amount_aed: 50000, category: 'revenue', is_internal: false },
    { txn_date: '2025-02-02', amount: -10000, amount_aed: -10000, category: 'fx_sweep', is_internal: true },
    { txn_date: '2025-02-03', amount: 10000, amount_aed: 10000, category: 'round_trip', is_internal: true },
  ];

  const result = engine.aggregateMonthly(txns, 30000);
  assertEq(result[0].revenue, 50000, 'aggregate: internals excluded from revenue');
  assertEq(result[0].operating_cash, 50000, 'aggregate: internals excluded from operating_cash');
}

// Multi-month aggregation
{
  const txns = [
    { txn_date: '2025-01-15', amount: 80000, amount_aed: 80000, category: 'revenue', is_internal: false },
    { txn_date: '2025-02-15', amount: 120000, amount_aed: 120000, category: 'revenue', is_internal: false },
    { txn_date: '2025-03-15', amount: 90000, amount_aed: 90000, category: 'revenue', is_internal: false },
  ];

  const result = engine.aggregateMonthly(txns, 30000);
  assertEq(result.length, 3, 'aggregate: 3 months');
  assertEq(result[0].month, '2025-01', 'aggregate: months sorted');
  assertEq(result[1].month, '2025-02', 'aggregate: months sorted');
  assertEq(result[2].month, '2025-03', 'aggregate: months sorted');
}

// Owner base salary = 0 edge case
{
  const txns = [
    { txn_date: '2025-04-01', amount: 50000, amount_aed: 50000, category: 'revenue', is_internal: false },
    { txn_date: '2025-04-02', amount: -10000, amount_aed: -10000, category: 'cogs', is_internal: false },
  ];

  const result = engine.aggregateMonthly(txns, 0);
  assertEq(result[0].real_surplus, 40000, 'aggregate: owner_base=0 → surplus = operating_cash');
  assertEq(result[0].owner_base, 0, 'aggregate: owner_base passed through');
}

// Empty transactions
{
  const result = engine.aggregateMonthly([], 30000);
  assertEq(result.length, 0, 'aggregate: empty → empty');
}

// No revenue month → cogs_pct null
{
  const txns = [
    { txn_date: '2025-05-01', amount: -5000, amount_aed: -5000, category: 'fees', is_internal: false },
  ];
  const result = engine.aggregateMonthly(txns, 30000);
  assertEq(result[0].cogs_pct, null, 'aggregate: no revenue → cogs_pct null');
}


// ════════════════════════════════════════════════════════════════
// 5. GENERIC CSV PARSER
// ════════════════════════════════════════════════════════════════
console.log('\n=== Generic CSV Parser Tests ===');

{
  const csv = `Date,Description,Amount,Currency,Type,Reference,Counterparty
2025-06-01,Payment received,5000,EUR,Transfer,REF001,Client ABC
2025-06-02,Service fee,-200,EUR,Fee,REF002,`;

  const txns = engine.parseGenericCsv(csv);
  assertEq(txns.length, 2, 'parseGenericCsv: 2 rows');
  assertEq(txns[0].txnDate, '2025-06-01', 'parseGenericCsv: date');
  assertEq(txns[0].amount, 5000, 'parseGenericCsv: amount');
  assertEq(txns[0].currency, 'EUR', 'parseGenericCsv: currency');
  assertEq(txns[0].counterparty, 'Client ABC', 'parseGenericCsv: counterparty');
}

// Custom mapping
{
  const csv = `data,descrizione,importo,valuta
01/03/2025,Pagamento,1000,USD`;

  const txns = engine.parseGenericCsv(csv, {
    date: 'data',
    description: 'descrizione',
    amount: 'importo',
    currency: 'valuta',
  });
  assertEq(txns.length, 1, 'parseGenericCsv: custom mapping');
  assertEq(txns[0].txnDate, '2025-03-01', 'parseGenericCsv: custom date field');
  assertEq(txns[0].currency, 'USD', 'parseGenericCsv: custom currency field');
}


// ════════════════════════════════════════════════════════════════
// 6. END-TO-END: Parse + Classify + Aggregate
// ════════════════════════════════════════════════════════════════
console.log('\n=== End-to-End Tests ===');

{
  const csv = `Account name,Account currency,Transaction type,Date,Ref. number,Description,Amount,Balance,Notes
Full Digital,AED,Transfers,05/01/2025,R001,"From Acme Corp - Invoice 100",200000,200000,
Full Digital,AED,Transfers,06/01/2025,R002,"From Beta LLC - Payment",150000,350000,
Full Digital,AED,Transfers,10/01/2025,R003,"To IFZA Free Zone - License",-80000,270000,
Full Digital,AED,Transfers,11/01/2025,R004,"To The Vat Consultant - Q4",-25000,245000,
Full Digital,AED,Transfers,12/01/2025,R005,"To Al Nadra - PRO services",-5000,240000,
Full Digital,AED,Transfers,15/01/2025,R006,"To Maria Mercedes Claps - Salary",-8000,232000,
Full Digital,AED,Transfers,15/01/2025,R007,"To Sara Tufo - Salary",-15000,217000,
Full Digital,AED,Transfers,16/01/2025,R008,"From Sara Tufo Consulting - Invoice",15000,232000,
Full Digital,AED,Transfers,20/01/2025,R009,"To Pellegrino Bozzella - Monthly",-60000,172000,
Full Digital,AED,Currency exchange,22/01/2025,FX01,"Currency exchange EUR to AED",-20000,152000,
Full Digital,AED,Currency exchange,22/01/2025,FX02,"Currency exchange EUR to AED",19950,171950,
Full Digital,AED,Fees,25/01/2025,FEE01,"Account maintenance fee",-150,171800,
Full Digital,AED,Transfers,28/01/2025,R010,"Credit Repayment - Loan 456",-3000,168800,
Full Digital,AED,Transfers,29/01/2025,R011,"To Random Vendor - Office supplies",-1200,167600,`;

  const parsed = engine.parseWioCsv(csv);
  assertEq(parsed.length, 14, 'e2e: 14 transactions parsed');

  const classified = engine.classifyTransactions(parsed, RULES, INTERNAL_PARTIES);

  // Check specific classifications
  const cats = classified.map(t => t.category);
  assertEq(cats[0], 'revenue', 'e2e: Acme Corp → revenue');
  assertEq(cats[1], 'revenue', 'e2e: Beta LLC → revenue');
  assertEq(cats[2], 'cogs', 'e2e: IFZA → cogs');
  assertEq(cats[3], 'cogs', 'e2e: Vat Consultant → cogs');
  assertEq(cats[4], 'cogs', 'e2e: Al Nadra → cogs');
  assertEq(cats[5], 'salary', 'e2e: Maria Mercedes Claps → salary');
  assertEq(cats[6], 'round_trip', 'e2e: Sara Tufo salary → round_trip');
  assertEq(cats[7], 'round_trip', 'e2e: Sara Tufo invoice → round_trip');
  assertEq(cats[8], 'owner_draw', 'e2e: Pellegrino Bozzella → owner_draw');
  assertEq(cats[9], 'fx_sweep', 'e2e: FX exchange out → fx_sweep');
  assertEq(cats[10], 'fx_sweep', 'e2e: FX exchange in → fx_sweep');
  assertEq(cats[11], 'fees', 'e2e: Account fee → fees');
  assertEq(cats[12], 'debt_repayment', 'e2e: Credit Repayment → debt_repayment');
  assertEq(cats[13], 'other', 'e2e: Random Vendor → other (fallback)');

  // Check internals
  const internals = classified.map(t => t.is_internal);
  assertEq(internals[6], true, 'e2e: Sara Tufo salary is_internal');
  assertEq(internals[7], true, 'e2e: Sara Tufo invoice is_internal');
  assertEq(internals[9], true, 'e2e: FX sweep is_internal');
  assertEq(internals[10], true, 'e2e: FX sweep is_internal');
  assertEq(internals[8], false, 'e2e: owner_draw NOT internal');

  // Aggregate and verify
  const agg = engine.aggregateMonthly(
    classified.map(t => ({
      txn_date: t.txnDate,
      amount: t.amount,
      amount_aed: t.amount,
      category: t.category,
      is_internal: t.is_internal,
    })),
    30000
  );
  assertEq(agg.length, 1, 'e2e: 1 month aggregated');

  const m = agg[0];
  // Revenue: 200K + 150K = 350K (Sara's 15K invoice excluded as internal)
  assertEq(m.revenue, 350000, 'e2e agg: revenue = 350K (Sara excluded)');

  // COGS: 80K + 25K + 5K = 110K
  assertEq(m.cogs, 110000, 'e2e agg: cogs = 110K');

  // Salaries: 8K only (Sara excluded as round_trip)
  assertEq(m.salaries, 8000, 'e2e agg: salaries = 8K (Sara excluded)');

  // Owner draw: 60K
  assertEq(m.owner_draw, 60000, 'e2e agg: owner_draw = 60K');

  // Fees: 150
  assertEq(m.fees, 150, 'e2e agg: fees = 150');

  // Debt: 3K
  assertEq(m.debt, 3000, 'e2e agg: debt = 3K');

  // Other: 1200
  assertEq(m.other, 1200, 'e2e agg: other = 1200');

  // Operating cash: 350K - 110K - 8K - 3K - 150 - 1200 = 227,650
  assertEq(m.operating_cash, 227650, 'e2e agg: operating_cash = 227,650');

  // Surplus: 227,650 - 30K = 197,650
  assertEq(m.real_surplus, 197650, 'e2e agg: real_surplus = 197,650');

  // Net flow: 227,650 - 60K = 167,650
  assertEq(m.net_flow, 167650, 'e2e agg: net_flow = 167,650');

  // Owner allowance: max(60K - 30K, 0) = 30K
  assertEq(m.owner_allowance, 30000, 'e2e agg: owner_allowance = 30K');

  // COGS%: 110K / 350K ≈ 31.4%
  assertClose(m.cogs_pct, 0.3143, 0.001, 'e2e agg: cogs_pct ≈ 31.4%');

  // FX sweeps: both legs excluded (the -20K and +19950 don't appear in any totals)
  // Sara: both legs excluded (-15K salary and +15K invoice)
  // This is the key validation: internal transactions are invisible to KPIs
}


// ════════════════════════════════════════════════════════════════
// 7. FAB PDF TEXT PARSER
// ════════════════════════════════════════════════════════════════
console.log('\n=== FAB PDF Text Parser Tests ===');

{
  const lines = [
    'Statement of Account',
    'Account Number: 1234567890',
    '01/03/2025 01/03/2025 TRF TO IFZA FREE ZONE REF FTS250301001 5,000.00 150,000.00',
    '05/03/2025 05/03/2025 SALARY CREDIT FROM ACME CORP 80,000.00 230,000.00',
    '10/03/2025 PAYMENT TO THE VAT CONSULTANT 2,500.00 227,500.00',
  ];

  const txns = engine.parseFabPdfText(lines);
  assert(txns.length >= 2, 'parseFabPdfText: parses multiple transactions');
  assertEq(txns[0].txnDate, '2025-03-01', 'parseFabPdfText: date DD/MM/YYYY');
  assertEq(txns[0].currency, 'AED', 'parseFabPdfText: default currency AED');
  assert(txns[0].refNumber, 'parseFabPdfText: has refNumber');
  assert(txns[0].description.length > 0, 'parseFabPdfText: has description');
}

{
  const lines = [
    '15/06/2025 15/06/2025 Transfer to Pellegrino Bozzella REF TRN123456 60,000.00 100,000.00',
  ];
  const txns = engine.parseFabPdfText(lines);
  assertEq(txns.length, 1, 'parseFabPdfText: single debit line');
  assert(txns[0].amount < 0 || txns[0].amount > 0, 'parseFabPdfText: non-zero amount');
  assert(txns[0].counterparty.length > 0, 'parseFabPdfText: extracts counterparty');
}

{
  const lines = [];
  const txns = engine.parseFabPdfText(lines);
  assertEq(txns.length, 0, 'parseFabPdfText: empty input → empty');
}

{
  const lines = [
    'This is a header line',
    'Another non-transaction line',
    'Page 1 of 3',
  ];
  const txns = engine.parseFabPdfText(lines);
  assertEq(txns.length, 0, 'parseFabPdfText: no dates → no transactions');
}

{
  const lines = [
    '20/04/2025 Credit deposit from Client XYZ 25,000.00 175,000.00',
  ];
  const txns = engine.parseFabPdfText(lines);
  assertEq(txns.length, 1, 'parseFabPdfText: credit line parsed');
}

// FAB PDF → Classify → Aggregate end-to-end
{
  const lines = [
    '01/01/2025 01/01/2025 Transfer credit from Acme Corp Invoice 100 200,000.00 200,000.00',
    '10/01/2025 10/01/2025 TRF TO IFZA FREE ZONE License REF FTS250110 80,000.00 120,000.00',
    '15/01/2025 15/01/2025 Transfer to Pellegrino Bozzella Monthly REF TRN150125 60,000.00 60,000.00',
  ];

  const parsed = engine.parseFabPdfText(lines);
  assert(parsed.length >= 2, 'fab e2e: parsed transactions from PDF text');

  const classified = engine.classifyTransactions(parsed, RULES, INTERNAL_PARTIES);
  const categories = classified.map(t => t.category);

  const hasCogs = categories.includes('cogs');
  const hasOwnerDraw = categories.includes('owner_draw');
  assert(hasCogs || hasOwnerDraw || categories.includes('revenue'), 'fab e2e: classified FAB transactions');
}


// ════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('='.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
