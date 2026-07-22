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
  function parseFabPdfText(textLines) {
    const rows = [];
    const dateRe = /^(\d{2}[\/\-]\d{2}[\/\-]\d{4})/;
    const amountRe = /[\d,]+\.\d{2}/g;

    let i = 0;
    while (i < textLines.length) {
      const line = textLines[i].trim();
      const dateMatch = line.match(dateRe);
      if (!dateMatch) { i++; continue; }

      const txnDateRaw = dateMatch[1];
      const txnDate = parseDate(txnDateRaw);
      if (!txnDate) { i++; continue; }

      let rest = line.slice(dateMatch[0].length).trim();

      let valueDateRaw = null;
      const vdMatch = rest.match(dateRe);
      if (vdMatch) {
        valueDateRaw = vdMatch[1];
        rest = rest.slice(vdMatch[0].length).trim();
      }

      let descParts = [rest];
      let j = i + 1;
      while (j < textLines.length && !textLines[j].trim().match(dateRe)) {
        const nextLine = textLines[j].trim();
        if (!nextLine) { j++; continue; }
        const onlyAmounts = nextLine.replace(/[\d,]+\.\d{2}/g, '').replace(/[A-Z]{3}/g, '').trim();
        if (!onlyAmounts && nextLine.match(amountRe)) break;
        descParts.push(nextLine);
        j++;
      }

      const fullText = descParts.join(' ');
      const amounts = fullText.match(amountRe);

      if (!amounts || amounts.length === 0) { i = Math.max(j, i + 1); continue; }

      let description = fullText;
      amounts.forEach(a => { description = description.replace(a, ''); });
      description = description.replace(/\s{2,}/g, ' ').trim();

      let debit = 0, credit = 0;
      const parsedAmounts = amounts.map(a => parseFloat(a.replace(/,/g, '')));

      if (parsedAmounts.length >= 3) {
        debit = parsedAmounts[0];
        credit = parsedAmounts[1];
      } else if (parsedAmounts.length === 2) {
        debit = parsedAmounts[0];
        credit = parsedAmounts[1];
      } else {
        const val = parsedAmounts[0];
        if (description.toLowerCase().includes('credit') || description.toLowerCase().includes('deposit') || description.toLowerCase().includes('transfer credit')) {
          credit = val;
        } else {
          debit = val;
        }
      }

      if (debit === 0 && credit === 0) { i = Math.max(j, i + 1); continue; }

      const amount = credit > 0 ? credit : -debit;

      let counterparty = '';
      const cpMatch = description.match(/(?:from|to|favouring|beneficiary)[:\s]+([^,\d][^,]*)/i);
      if (cpMatch) counterparty = cpMatch[1].trim();
      if (!counterparty) {
        const words = description.split(/\s+/).filter(w => w.length > 2 && !/^\d/.test(w) && !['THE','FOR','AND','REF','TRF','FTS','IPI'].includes(w.toUpperCase()));
        counterparty = words.slice(0, 4).join(' ');
      }

      const refMatch = description.match(/(?:ref(?:erence)?|trn)[.:\s]*([A-Z0-9]{6,})/i);
      const refNumber = refMatch ? refMatch[1] : `FAB_${txnDate}_${Math.abs(amount).toFixed(2)}`;

      rows.push({
        txnDate,
        valueDate: valueDateRaw ? parseDate(valueDateRaw) : null,
        description,
        counterparty,
        amount,
        currency: 'AED',
        txType: '',
        refNumber,
        notes: '',
        raw: { original_line: fullText },
      });

      i = Math.max(j, i + 1);
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

  async function extractPdfText(arrayBuffer) {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let lastY = null;
      let currentLine = '';
      content.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        currentLine += (currentLine ? ' ' : '') + item.str;
        lastY = y;
      });
      if (currentLine.trim()) lines.push(currentLine.trim());
    }
    return lines;
  }

  async function parseFabPdf(arrayBuffer) {
    const lines = await extractPdfText(arrayBuffer);
    return parseFabPdfText(lines);
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
    parseFabPdfText,
    extractPdfText,
    loadPdfJs,
  };

})();
