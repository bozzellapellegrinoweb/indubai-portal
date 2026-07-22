// ============================================================
// Group Cashflow — Classification Engine + Parsers
// ============================================================

(function () {

  // ── Wio CSV Parser ──────────────────────────────────────────
  function parseWioCsv(csvText) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]);
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h.trim()] = i; });

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;

      const desc = (cols[colIdx['Description']] || '').trim();
      const amount = parseFloat((cols[colIdx['Amount']] || '0').replace(/,/g, ''));
      if (isNaN(amount)) continue;

      let counterparty = '';
      const fromMatch = desc.match(/From\s+(.+?)(?:\s+[-–]|$)/i);
      const toMatch = desc.match(/To\s+(.+?)(?:\s+[-–]|$)/i);
      if (fromMatch) counterparty = fromMatch[1].trim();
      else if (toMatch) counterparty = toMatch[1].trim();

      const dateStr = (cols[colIdx['Date']] || '').trim();
      const txnDate = parseDate(dateStr);
      if (!txnDate) continue;

      rows.push({
        txnDate,
        description: desc,
        counterparty,
        amount,
        currency: (cols[colIdx['Account currency']] || 'AED').trim(),
        txType: (cols[colIdx['Transaction type']] || '').trim(),
        refNumber: (cols[colIdx['Ref. number']] || '').trim(),
        notes: (cols[colIdx['Notes']] || '').trim(),
        raw: Object.fromEntries(headers.map((h, j) => [h.trim(), (cols[j] || '').trim()])),
      });
    }
    return rows;
  }

  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function parseDate(s) {
    if (!s) return null;
    // DD/MM/YYYY or DD-MM-YYYY
    let m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    // Try JS Date
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return null;
  }

  // ── Generic CSV Parser ──────────────────────────────────────
  function parseGenericCsv(csvText, mapping) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]);
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h.trim()] = i; });

    const map = mapping || {};
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const desc = (cols[colIdx[map.description || 'Description']] || '').trim();
      const amountStr = (cols[colIdx[map.amount || 'Amount']] || '0').replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (isNaN(amount)) continue;

      const dateStr = (cols[colIdx[map.date || 'Date']] || '').trim();
      const txnDate = parseDate(dateStr);
      if (!txnDate) continue;

      rows.push({
        txnDate,
        description: desc,
        counterparty: (cols[colIdx[map.counterparty || 'Counterparty']] || '').trim(),
        amount,
        currency: (cols[colIdx[map.currency || 'Currency']] || 'AED').trim(),
        txType: (cols[colIdx[map.txType || 'Type']] || '').trim(),
        refNumber: (cols[colIdx[map.refNumber || 'Reference']] || '').trim(),
        notes: '',
        raw: Object.fromEntries(headers.map((h, j) => [h.trim(), (cols[j] || '').trim()])),
      });
    }
    return rows;
  }

  // ── Classification Engine ───────────────────────────────────
  function classifyTransactions(txns, rules, internalParties) {
    const sortedRules = [...rules].filter(r => r.active !== false).sort((a, b) => a.priority - b.priority);
    const parties = (internalParties || []).map(p => p.name_pattern.toLowerCase());

    return txns.map(txn => {
      if (txn.category_locked) return txn;

      // Step 2: check internal parties first (priority 200 equivalent)
      const cp = (txn.counterparty || '').toLowerCase();
      if (cp && parties.some(p => cp.includes(p))) {
        return { ...txn, category: 'round_trip', is_internal: true };
      }

      // Apply rules in priority order
      for (const rule of sortedRules) {
        if (matchRule(txn, rule)) {
          return { ...txn, category: rule.set_category, is_internal: rule.set_internal || false };
        }
      }

      // Step 8: Revenue (positive non-internal transfers)
      if (txn.amount > 0) {
        const revTypes = ['transfers', 'cheque', 'cash', ''];
        const tt = (txn.txType || '').toLowerCase();
        if (revTypes.includes(tt) || !tt) {
          return { ...txn, category: 'revenue', is_internal: false };
        }
      }

      // Step 9: Fallback
      return { ...txn, category: 'other', is_internal: false };
    });
  }

  function matchRule(txn, rule) {
    const field = rule.match_field;
    let value = '';
    if (field === 'counterparty') value = (txn.counterparty || '').toLowerCase();
    else if (field === 'description') value = (txn.description || '').toLowerCase();
    else if (field === 'tx_type') value = txn.txType || txn.tx_type || '';

    const matchVal = rule.match_value;

    switch (rule.match_op) {
      case 'contains': return value.toLowerCase().includes(matchVal.toLowerCase());
      case 'equals': return value.toLowerCase() === matchVal.toLowerCase();
      case 'regex': {
        try { return new RegExp(matchVal, 'i').test(value); } catch { return false; }
      }
      default: return false;
    }
  }

  // ── Aggregation helpers ─────────────────────────────────────
  function aggregateMonthly(transactions, ownerBaseSalary) {
    ownerBaseSalary = ownerBaseSalary != null ? ownerBaseSalary : 30000;
    const months = {};

    transactions.filter(t => !t.is_internal).forEach(t => {
      const m = t.txn_date ? t.txn_date.slice(0, 7) : null;
      if (!m) return;
      if (!months[m]) months[m] = { revenue: 0, cogs: 0, salaries: 0, debt: 0, fees: 0, other: 0, owner_draw: 0 };
      const amt = parseFloat(t.amount_aed || t.amount) || 0;
      const cat = t.category;
      if (cat === 'revenue') months[m].revenue += amt;
      else if (cat === 'cogs') months[m].cogs += Math.abs(amt);
      else if (cat === 'salary') months[m].salaries += Math.abs(amt);
      else if (cat === 'debt_repayment') months[m].debt += Math.abs(amt);
      else if (cat === 'fees') months[m].fees += Math.abs(amt);
      else if (cat === 'owner_draw') months[m].owner_draw += Math.abs(amt);
      else if (cat === 'other') months[m].other += Math.abs(amt);
    });

    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => {
      const opCash = d.revenue - d.cogs - d.salaries - d.debt - d.fees - d.other;
      const surplus = opCash - ownerBaseSalary;
      const allowance = Math.max(d.owner_draw - ownerBaseSalary, 0);
      const netFlow = opCash - d.owner_draw;
      const cogsPct = d.revenue > 0 ? d.cogs / d.revenue : null;
      return { month, ...d, operating_cash: opCash, real_surplus: surplus, owner_allowance: allowance, net_flow: netFlow, cogs_pct: cogsPct, owner_base: ownerBaseSalary };
    });
  }

  // ── FAB PDF Parser ──────────────────────────────────────────
  // FAB statements have columns: DATE | VALUE DATE | DESCRIPTION | DEBIT | CREDIT | BALANCE
  // X coordinate thresholds (from actual FAB PDFs):
  //   Date: x < 80, ValueDate: 80-150, Description: 150-340, Debit: 340-420, Credit: 420-510, Balance: 510+
  const FAB_COL = { DESC: 150, DEBIT: 340, CREDIT: 420, BALANCE: 510 };
  const FAB_DATE_RE = /^(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})$/i;
  const FAB_MONTHS = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };

  function parseFabDate(s) {
    if (!s) return null;
    const m = s.trim().match(FAB_DATE_RE);
    if (!m) return parseDate(s);
    return `${m[3]}-${FAB_MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  }

  function parseFabPdfItems(pages) {
    const SKIP = /opening balance|balance brought forward|balance carried forward|closing statement/i;
    const rows = [];

    for (const pageItems of pages) {
      const lineMap = {};
      pageItems.forEach(item => {
        const y = Math.round(item.transform[5]);
        const x = Math.round(item.transform[4]);
        if (!lineMap[y]) lineMap[y] = [];
        lineMap[y].push({ x, text: item.str });
      });

      const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
      let currentTxn = null;

      for (const y of sortedYs) {
        const items = lineMap[y].sort((a, b) => a.x - b.x);
        const fullLine = items.map(i => i.text).join(' ').trim();

        if (!fullLine || SKIP.test(fullLine)) {
          if (currentTxn) { rows.push(currentTxn); currentTxn = null; }
          continue;
        }

        const dateItems = items.filter(i => i.x < 80);
        const dateText = dateItems.map(i => i.text).join(' ').trim();
        const dateMatch = dateText.match(FAB_DATE_RE);

        if (dateMatch) {
          if (currentTxn) rows.push(currentTxn);

          const txnDate = parseFabDate(dateText);
          const vdItems = items.filter(i => i.x >= 80 && i.x < FAB_COL.DESC);
          const valueDate = parseFabDate(vdItems.map(i => i.text).join(' ').trim());

          const descItems = items.filter(i => i.x >= FAB_COL.DESC && i.x < FAB_COL.DEBIT);
          const description = descItems.map(i => i.text).join(' ').trim();

          const debitItems = items.filter(i => i.x >= FAB_COL.DEBIT && i.x < FAB_COL.CREDIT);
          const creditItems = items.filter(i => i.x >= FAB_COL.CREDIT && i.x < FAB_COL.BALANCE);

          const debitText = debitItems.map(i => i.text).join('').replace(/[,\s]/g, m => m === ',' ? '' : m).trim();
          const creditText = creditItems.map(i => i.text).join('').replace(/[,\s]/g, m => m === ',' ? '' : m).trim();

          const debit = parseFloat(debitText.replace(/,/g, '')) || 0;
          const credit = parseFloat(creditText.replace(/,/g, '')) || 0;
          const amount = credit > 0 ? credit : -debit;

          if (amount === 0) { currentTxn = null; i++; continue; }

          currentTxn = {
            txnDate,
            valueDate,
            description,
            descLines: [],
            counterparty: '',
            amount,
            currency: 'AED',
            txType: description,
            refNumber: '',
            notes: '',
            raw: { original_line: fullLine },
          };
        } else if (currentTxn) {
          const contItems = items.filter(i => i.x >= FAB_COL.DESC && i.x < FAB_COL.DEBIT);
          const contText = contItems.length ? contItems.map(i => i.text).join(' ').trim() : fullLine;
          if (contText && !/^DATE|^VALUE DATE|^DESCRIPTION|^DEBIT|^CREDIT|^BALANCE|^Sheet no|^Currency|^PBTAX|^PLATINUM|^Dubai|^00000|^Tot\.|^Total|^Debit Interest|^Closing Book|^\*|^Important|^We shall|^First Abu/i.test(contText)) {
            currentTxn.descLines.push(contText);
          }
        }
      }
      if (currentTxn) { rows.push(currentTxn); currentTxn = null; }
    }

    return rows.map(txn => {
      const allDesc = [txn.description, ...txn.descLines].join(' ');

      let counterparty = '';
      const remitterMatch = allDesc.match(/Remitter Info\s*:\s*(?:\d{3}\s+\d{3}\s+)?(.+?)(?:,\s*Sender|$)/i);
      if (remitterMatch) {
        counterparty = remitterMatch[1].trim()
          .replace(/\s*OPER\s*ATING\s+AS\b/i, ' OPERATING AS').trim();
      }
      if (!counterparty) {
        const benefMatch = allDesc.match(/Beneficiary[:\s]+([^,\d][^,]*)/i);
        if (benefMatch) counterparty = benefMatch[1].trim();
      }
      if (!counterparty) {
        const outMatch = allDesc.match(/OUTWARD\s+TRANS(?:FER)?\s+(.+?)(?:\s+REF|\s+Ref:|,|$)/i);
        if (outMatch) counterparty = outMatch[1].trim();
      }
      if (!counterparty) {
        const descOnly = txn.description;
        const posMatch = descOnly.match(/POS Settlement\s+(.+)/i);
        if (posMatch) counterparty = posMatch[1].trim();
      }

      const ftMatch = allDesc.match(/\b(FT\d{5}[A-Z0-9]+)\b/);
      const refMatch = allDesc.match(/Ref:\s*([A-Z0-9]+)/i);
      const ippMatch = allDesc.match(/IPP Ref:\s*([A-Z0-9]+)/i);
      const refNumber = ftMatch ? ftMatch[1] : (ippMatch ? ippMatch[1] : (refMatch ? refMatch[1] : `FAB_${txn.txnDate}_${Math.abs(txn.amount).toFixed(2)}`));

      delete txn.descLines;
      return {
        ...txn,
        description: allDesc.slice(0, 500),
        counterparty,
        refNumber,
      };
    });
  }

  function parseFabPdfText(textLines) {
    const rows = [];
    const SKIP = /opening balance|balance brought forward|balance carried forward|closing statement/i;
    const dateRe = /^(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i;

    let i = 0;
    while (i < textLines.length) {
      const line = textLines[i].trim();
      if (!line || SKIP.test(line)) { i++; continue; }
      const dateMatch = line.match(dateRe);
      if (!dateMatch) { i++; continue; }

      const txnDate = parseFabDate(dateMatch[0]);
      if (!txnDate) { i++; continue; }

      let rest = line.slice(dateMatch[0].length).trim();
      let valueDate = null;
      const vdMatch = rest.match(dateRe);
      if (vdMatch) {
        valueDate = parseFabDate(vdMatch[0]);
        rest = rest.slice(vdMatch[0].length).trim();
      }

      let descParts = [rest];
      let j = i + 1;
      while (j < textLines.length) {
        const next = textLines[j].trim();
        if (!next || next.match(dateRe) || SKIP.test(next)) break;
        if (/^(DATE|Sheet no|Currency|PBTAX|PLATINUM|Dubai|00000|Tot\.|Total|Debit Interest|Closing Book|\*|Important|We shall|First Abu)/i.test(next)) break;
        descParts.push(next);
        j++;
      }

      const fullText = descParts.join(' ');
      const amounts = fullText.match(/[\d,]+\.\d{2}/g);
      if (!amounts || amounts.length === 0) { i = j; continue; }

      let description = fullText;
      amounts.forEach(a => { description = description.replace(a, ''); });
      description = description.replace(/\s{2,}/g, ' ').trim();

      const lastAmount = parseFloat(amounts[amounts.length - 1].replace(/,/g, ''));
      let amount;
      if (amounts.length >= 2) {
        const txnAmount = parseFloat(amounts[amounts.length - 2].replace(/,/g, ''));
        const isCredit = /inward|credit|deposit|incoming/i.test(description);
        amount = isCredit ? txnAmount : -txnAmount;
      } else {
        amount = -lastAmount;
      }

      let counterparty = '';
      const remitterMatch = description.match(/Remitter Info:.*?(\d{3}\s+\d{3}\s+)?(.+?)(?:,\s*Sender|$)/i);
      if (remitterMatch) counterparty = remitterMatch[2].trim();
      if (!counterparty) {
        const cpMatch = description.match(/(?:from|to|favouring|beneficiary)[:\s]+([^,\d][^,]*)/i);
        if (cpMatch) counterparty = cpMatch[1].trim();
      }

      const ftMatch = fullText.match(/\b(FT\d{5}[A-Z0-9]+)\b/);
      const refMatch = fullText.match(/Ref:\s*([A-Z0-9]+)/i);
      const refNumber = ftMatch ? ftMatch[1] : (refMatch ? refMatch[1] : `FAB_${txnDate}_${Math.abs(amount).toFixed(2)}`);

      rows.push({
        txnDate,
        valueDate,
        description: description.slice(0, 500),
        counterparty,
        amount,
        currency: 'AED',
        txType: '',
        refNumber,
        notes: '',
        raw: { original_line: fullText },
      });

      i = j;
    }
    return rows;
  }

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Impossibile caricare PDF.js'));
      document.head.appendChild(s);
    });
  }

  async function extractPdfPages(arrayBuffer) {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(content.items);
    }
    return pages;
  }

  async function parseFabPdf(arrayBuffer) {
    const pages = await extractPdfPages(arrayBuffer);
    return parseFabPdfItems(pages);
  }

  // ── Category suggestion for uncategorised transactions ──────
  function suggestCategory(txn) {
    const desc = (txn.description || '').toLowerCase();
    const cp = (txn.counterparty || '').toLowerCase();
    const tt = (txn.tx_type || txn.txType || '').toLowerCase();
    const amt = parseFloat(txn.amount_aed || txn.amount) || 0;
    const combined = `${desc} ${cp} ${tt}`;

    // Fees patterns
    if (/\b(fee|charge|commission|commissione|penalty|penale|vat on|service charge|account maintenance|swift charge|sms alert|debit interest)\b/i.test(combined)) return 'fees';
    if (tt === 'fees') return 'fees';

    // Debt repayment
    if (/\b(repayment|autopay|emi\b|loan|rata|mutuo|credit card payment|installment)\b/i.test(combined)) return 'debt_repayment';

    // Salary patterns (outgoing)
    if (amt < 0 && /\b(salary|salario|stipendio|wps|wage|payroll)\b/i.test(combined)) return 'salary';

    // Revenue (incoming with invoice/payment patterns)
    if (amt > 0 && /\b(invoice|fattura|pagamento|payment received|ricevuto|inward|incoming|credit transfer)\b/i.test(combined)) return 'revenue';

    // If positive and no other match, likely revenue
    if (amt > 0) return 'revenue';

    // COGS (outgoing to vendors/services)
    if (amt < 0 && /\b(hosting|server|cloud|software|license|licenza|dominio|domain|consultant|consulen|freelanc|subcontract|fornitore|supplier|servizi|agenzia|agency)\b/i.test(combined)) return 'cogs';

    return null; // no suggestion
  }

  // ── Expose globals ──────────────────────────────────────────
  window.financeEngine = {
    parseWioCsv,
    parseGenericCsv,
    parseCsvLine,
    classifyTransactions,
    aggregateMonthly,
    matchRule,
    parseFabPdf,
    parseFabPdfItems,
    parseFabPdfText,
    parseFabDate,
    extractPdfPages,
    loadPdfJs,
    suggestCategory,
  };

})();
