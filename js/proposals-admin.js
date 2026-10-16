// ============================================================
// Proposte — scheda cliente (lato amministratore)
// ============================================================
// Usa: clientId e clientData di client-detail.html, sb/ui di js/supabase.js.
// Scrive solo tramite la Edge Function proposal-admin; legge le tabelle
// proposal_* via REST (RLS: solo staff).
// ============================================================
(function () {
  'use strict';

  const FN = () => `${window.ENV_SUPABASE_URL}/functions/v1/proposal-admin`;
  const EN = () => !!(window.i18n && window.i18n.isEN && window.i18n.isEN());
  const T = (it, en) => (EN() ? en : it);
  const esc = (s) => ui.escapeHtml(s == null ? '' : String(s));
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const PAGE_WIDTH = 1240;      // larghezza delle immagini di pagina
  const MAX_PDF_MB = 15;

  let cfg = null;               // risposta di config
  let list = [];                // proposte del cliente

  // ── Chiamate alla function ─────────────────────────────────
  async function call(action, body = {}, _retry = true) {
    const tok = sb.getSession()?.access_token;
    const r = await fetch(FN(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, apikey: window.ENV_SUPABASE_ANON_KEY },
      body: JSON.stringify({ action, ...body }),
    });
    if (r.status === 401 && _retry) {
      // sbFetch rinnova la sessione su 401: una lettura qualsiasi basta.
      try { await sb.db.select('profiles', { columns: 'id', limit: 1 }); } catch (_) {}
      return call(action, body, false);
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || ('HTTP ' + r.status)); e.code = d.code; throw e; }
    return d;
  }

  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(new Error('Lettura file non riuscita'));
      fr.readAsDataURL(file);
    });
  }

  // ── pdf.js caricato solo quando serve ──────────────────────
  let pdfjsReady = null;
  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = async () => {
        try {
          // La CSP ammette worker solo da 'self' e blob:: il worker si scarica
          // e si avvia da un blob.
          const code = await (await fetch(PDFJS_WORKER)).text();
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          resolve(window.pdfjsLib);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('pdf.js non caricato'));
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  async function renderPage(pdf, n) {
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PAGE_WIDTH / v1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    const b64 = await fileToBase64(blob);
    return { b64, w: canvas.width, h: canvas.height };
  }

  // ── Stato ──────────────────────────────────────────────────
  const STATUS = {
    draft:         ['badge-pending', T('Bozza', 'Draft')],
    sent:          ['badge-info',    T('Inviata', 'Sent')],
    opened:        ['badge-warn',    T('Aperta', 'Opened')],
    expired:       ['badge-fail',    T('Scaduta', 'Expired')],
    signed:        ['badge-warn',    T('Firmata · da controfirmare', 'Signed · to countersign')],
    countersigned: ['badge-ok',      T('Controfirmata', 'Countersigned')],
    revoked:       ['badge-fail',    T('Revocata', 'Revoked')],
  };
  function effectiveStatus(p) {
    if (['sent', 'opened'].includes(p.status) && new Date(p.expires_at) < new Date()) return 'expired';
    return p.status;
  }
  const badge = (st) => { const [c, l] = STATUS[st] || ['badge-pending', st]; return `<span class="badge ${c}">${l}</span>`; };
  const dt = (d) => d ? new Date(d).toLocaleString(EN() ? 'en-GB' : 'it-IT', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const money = (a, c) => a == null ? '—' : `${c} ${Number(a).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;

  const EVENT_LABEL = {
    published: T('Proposta inviata (link attivo)', 'Proposal sent (link active)'),
    link_copied: T('Link copiato', 'Link copied'),
    otp_requested: T('Codice richiesto', 'Code requested'),
    otp_unknown_number: T('Numero non registrato', 'Unregistered number'),
    otp_delivery_failed: T('Invio codice fallito', 'Code delivery failed'),
    otp_failed: T('Codice sbagliato', 'Wrong code'),
    otp_locked: T('Codice bloccato (troppi errori)', 'Code locked (too many errors)'),
    otp_verified: T('Codice verificato', 'Code verified'),
    opened: T('Prima apertura', 'First opened'),
    reopened: T('Riaperta', 'Reopened'),
    new_device: T('Dispositivo nuovo (informativo)', 'New device (informative)'),
    new_country: T('Paese nuovo (informativo)', 'New country (informative)'),
    session_ip_changed: T('IP cambiato in sessione', 'IP changed in session'),
    session_device_changed: T('Browser cambiato in sessione', 'Browser changed in session'),
    session_expired: T('Sessione scaduta', 'Session expired'),
    session_closed: T('Uscita', 'Signed out'),
    read_to_end: T('Letta fino in fondo', 'Read to the end'),
    signed: T('Firmata dal cliente', 'Signed by client'),
    countersigned: T('Controfirmata', 'Countersigned'),
    completed: T('PDF finale generato', 'Final PDF generated'),
    final_sent_client: T('PDF inviato al cliente', 'PDF emailed to client'),
    final_send_failed: T('Invio PDF al cliente fallito', 'PDF email to client failed'),
    revoked: T('Link revocato', 'Link revoked'),
    extended: T('Scadenza prorogata', 'Expiry extended'),
    link_regenerated: T('Link rigenerato', 'Link regenerated'),
  };

  // ── Pannello ───────────────────────────────────────────────
  async function load() {
    const el = document.getElementById('proposte-content');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div></div>';
    try {
      const [rows, conf] = await Promise.all([
        sb.db.select('proposals', {
          filter: `client_id=eq.${clientId}`,
          columns: 'id,title,amount,currency,locale,status,expires_at,created_at,sent_at,first_opened_at,signed_at,countersigned_at,page_count,original_pdf_sha256,final_pdf_sha256,client_file_id,revoked_at,' +
                   'proposal_recipients!proposal_recipients_proposal_id_fkey(full_name,phone_e164,email,can_sign,position),' +
                   'proposal_signatures(kind,signer_name,method,signed_at,signed_at_dubai,verified_phone,ip,country)',
          order: 'created_at.desc',
        }),
        cfg ? Promise.resolve(cfg) : call('config').catch(() => ({ is_admin: false })),
      ]);
      cfg = conf; list = rows || [];
      render();
      const want = new URLSearchParams(location.search).get('proposal');
      if (want && list.some((p) => p.id === want)) toggleTimeline(want);
    } catch (e) {
      el.innerHTML = `<div style="color:var(--danger);padding:20px">${T('Errore', 'Error')}: ${esc(e.message)}</div>`;
    }
  }

  function render() {
    const el = document.getElementById('proposte-content');
    const admin = cfg?.is_admin;
    let h = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">${list.length} ${T('proposte', 'proposals')}${cfg?.otp_provider ? ` · ${T('codici via', 'codes via')} <b>${esc(cfg.otp_provider)}</b>` : ''}</div>
      ${admin ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="Proposte.openCountersignSetup()">${cfg.countersignature ? T('Modifica la mia firma', 'Edit my signature') : T('Imposta la mia firma', 'Set my signature')}</button>
        <button class="btn btn-accent btn-sm" onclick="Proposte.openNew()">+ ${T('Nuova proposta', 'New proposal')}</button></div>` : ''}
    </div>`;
    if (!list.length) {
      h += `<div style="text-align:center;padding:40px;color:var(--text-muted)">${T('Nessuna proposta per questo cliente.', 'No proposals for this client.')}</div>`;
    }
    for (const p of list) {
      const st = effectiveStatus(p);
      const recs = (p.proposal_recipients || []).sort((a, b) => a.position - b.position);
      const cs = (p.proposal_signatures || []).find((s) => s.kind === 'client');
      const active = ['sent', 'opened'].includes(p.status);
      h += `<div class="card" style="margin-bottom:12px;padding:16px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">${esc(p.title)}</div>
            <div style="font-size:12px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
              <span>${esc(money(p.amount, p.currency))}</span>
              <span>${T('Scadenza', 'Expires')}: ${dt(p.expires_at)}</span>
              <span>${p.page_count} ${T('pag.', 'pp.')}</span>
              <span>${(p.locale || 'it').toUpperCase()}</span>
            </div>
          </div>
          <div>${badge(st)}</div>
        </div>
        <div style="font-size:12px;margin-top:10px;display:flex;flex-direction:column;gap:3px">
          ${recs.map((r) => `<div>${r.can_sign ? '✍️' : '👁️'} <b>${esc(r.full_name)}</b> · ${esc(r.phone_e164)}${r.email ? ' · ' + esc(r.email) : ''}</div>`).join('')}
          ${p.first_opened_at ? `<div style="color:var(--text-muted)">${T('Aperta il', 'Opened on')} ${dt(p.first_opened_at)}</div>` : ''}
          ${cs ? `<div style="color:var(--text-muted)">${T('Firmata da', 'Signed by')} <b>${esc(cs.signer_name)}</b> ${T('il', 'on')} ${esc(cs.signed_at_dubai)} · ${esc(cs.verified_phone || '')} · IP ${esc(cs.ip || '—')}${cs.country ? ' (' + esc(cs.country) + ')' : ''}</div>` : ''}
          ${p.final_pdf_sha256 ? `<div style="color:var(--text-muted);word-break:break-all">SHA-256 PDF ${T('finale', 'final')}: ${esc(p.final_pdf_sha256)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          ${admin && p.status !== 'draft' && active ? `<button class="btn btn-ghost btn-sm" onclick="Proposte.copyLink('${p.id}')">🔗 ${T('Copia link', 'Copy link')}</button>` : ''}
          ${admin && active ? `<button class="btn btn-ghost btn-sm" onclick="Proposte.extend('${p.id}')">⏱ ${T('Proroga', 'Extend')}</button>
            <button class="btn btn-ghost btn-sm" onclick="Proposte.regenerate('${p.id}')">↻ ${T('Nuovo link', 'New link')}</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Proposte.revoke('${p.id}')">⛔ ${T('Revoca', 'Revoke')}</button>` : ''}
          ${admin && p.status === 'signed' ? `<button class="btn btn-accent btn-sm" onclick="Proposte.countersign('${p.id}')">✍️ ${T('Controfirma', 'Countersign')}</button>` : ''}
          ${admin && p.status === 'draft' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Proposte.deleteDraft('${p.id}')">${T('Elimina bozza', 'Delete draft')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="Proposte.preview('${p.id}')">👁 ${T('Anteprima', 'Preview')}</button>
          ${p.final_pdf_sha256 ? `<button class="btn btn-ghost btn-sm" onclick="Proposte.openFinal('${p.id}')">⬇ PDF ${T('firmato', 'signed')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="Proposte.toggleTimeline('${p.id}')">📜 ${T('Registro', 'Log')}</button>
        </div>
        <div id="pp-tl-${p.id}" style="display:none;margin-top:12px"></div>
      </div>`;
    }
    el.innerHTML = h;
  }

  async function toggleTimeline(id) {
    const box = document.getElementById('pp-tl-' + id);
    if (!box) return;
    if (box.style.display === 'block') { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const [ev, chk] = await Promise.all([
        sb.db.select('proposal_events', { filter: `proposal_id=eq.${id}`, columns: 'id,event_type,actor_type,ip,country,user_agent,details,created_at', order: 'id.asc' }),
        call('verify_log', { id }).catch(() => null),
      ]);
      box.innerHTML = `<div style="font-size:11px;margin-bottom:8px;color:${chk?.ok ? 'var(--success)' : 'var(--danger)'}">
          ${chk ? (chk.ok ? '✓ ' + T('Registro integro (catena di hash verificata)', 'Log intact (hash chain verified)') : '✕ ' + T('Catena di hash interrotta all\'evento', 'Hash chain broken at event') + ' #' + chk.broken_at) : ''}</div>
        <div style="border-left:2px solid var(--border);padding-left:12px;display:flex;flex-direction:column;gap:6px">
        ${(ev || []).map((e) => `<div style="font-size:12px">
          <span style="color:var(--text-muted)">${dt(e.created_at)}</span> · <b>${esc(EVENT_LABEL[e.event_type] || e.event_type)}</b>
          ${e.ip ? `<span style="color:var(--text-muted)"> · IP ${esc(e.ip)}${e.country ? ' ' + esc(e.country) : ''}</span>` : ''}
        </div>`).join('') || T('Nessun evento', 'No events')}</div>`;
    } catch (e) { box.innerHTML = esc(e.message); }
  }

  // ── Azioni sulla singola proposta ─────────────────────────
  async function copyLink(id) {
    try {
      const { link } = await call('link', { id });
      await shareDialog(link, list.find((p) => p.id === id));
    } catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function extend(id) {
    const d = prompt(T('Prorogare di quanti giorni?', 'Extend by how many days?'), '7');
    if (!d) return;
    try { await call('extend', { id, days: Number(d) }); ui.showToast(T('Scadenza prorogata', 'Expiry extended'), 'success'); load(); }
    catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function revoke(id) {
    if (!confirm(T('Revocare il link? Il cliente non potrà più aprire nè firmare la proposta. Non si può annullare.', 'Revoke the link? The client will no longer be able to open or sign. This cannot be undone.'))) return;
    try { await call('revoke', { id }); ui.showToast(T('Link revocato', 'Link revoked'), 'success'); load(); }
    catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function regenerate(id) {
    if (!confirm(T('Creare un nuovo link? Quello vecchio smette subito di funzionare.', 'Create a new link? The old one stops working immediately.'))) return;
    try { const { link } = await call('regenerate_link', { id }); load(); await shareDialog(link, list.find((p) => p.id === id)); }
    catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function deleteDraft(id) {
    if (!confirm(T('Eliminare la bozza?', 'Delete the draft?'))) return;
    try { await call('delete_draft', { id }); load(); } catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function preview(id) {
    try {
      const f = await call('files', { id });
      const m = modal(T('Anteprima (senza filigrana, solo staff)', 'Preview (no watermark, staff only)'),
        `<div style="display:flex;flex-direction:column;gap:10px">${f.pages.map((p) => `<img src="${esc(p.url)}" alt="" style="width:100%;border:1px solid var(--border);border-radius:6px">`).join('')}
         ${f.original_pdf ? `<a class="btn btn-ghost btn-sm" href="${esc(f.original_pdf)}" target="_blank" rel="noopener">PDF ${T('originale', 'original')}</a>` : ''}</div>`, 760);
      void m;
    } catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function openFinal(id) {
    try { const f = await call('files', { id }); if (f.final_pdf) window.open(f.final_pdf, '_blank', 'noopener'); }
    catch (e) { ui.showToast(e.message, 'error'); }
  }

  async function countersign(id) {
    if (!cfg?.countersignature) {
      ui.showToast(T('Prima imposta la tua firma', 'Set your signature first'), 'error');
      return openCountersignSetup(() => countersign(id));
    }
    const p = list.find((x) => x.id === id);
    if (!confirm(T(`Controfirmare "${p?.title}"? Verrà generato il PDF finale, inviato per email e salvato nei documenti. Dopo non sarà più modificabile.`,
                   `Countersign "${p?.title}"? The final PDF will be generated, emailed and saved in documents. It cannot be changed afterwards.`))) return;
    ui.showToast(T('Controfirma in corso…', 'Countersigning…'));
    try {
      await call('countersign', { id });
      ui.showToast(T('Controfirmata: PDF finale inviato e salvato', 'Countersigned: final PDF sent and saved'), 'success', 5000);
      load();
    } catch (e) { ui.showToast(e.message, 'error', 6000); load(); }
  }

  // ── Modale generica ───────────────────────────────────────
  function modal(title, body, maxW = 640, footer = '') {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" style="max-width:${maxW}px">
      <div class="modal-header"><div class="modal-title">${title}</div>
        <button class="btn btn-ghost btn-sm" data-close>✕</button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  async function shareDialog(link, p) {
    const recs = (p?.proposal_recipients || []);
    const msg = (r) => (p?.locale === 'en'
      ? `Dear ${r.full_name}, here is the proposal "${p.title}" from PB TAX. Open the link and enter your phone number to receive the access code: ${link}`
      : `Gentile ${r.full_name}, ecco la proposta "${p?.title}" di PB TAX. Apri il link e inserisci il tuo numero di telefono per ricevere il codice di accesso: ${link}`);
    const m = modal(T('Link della proposta', 'Proposal link'), `
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">${T('Il link funziona solo con i numeri registrati e un codice di accesso. Mandalo tu, per WhatsApp o email.', 'The link only works with registered numbers and an access code. Send it yourself via WhatsApp or email.')}</p>
      <div style="display:flex;gap:8px"><input class="form-control" readonly value="${esc(link)}" id="pp-link" style="font-family:monospace;font-size:12px">
      <button class="btn btn-accent btn-sm" id="pp-copy">${T('Copia', 'Copy')}</button></div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
      ${recs.map((r) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
          <span><b>${esc(r.full_name)}</b> · ${esc(r.phone_e164)}</span>
          <span style="display:flex;gap:6px">
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(r.phone_e164.replace('+', ''))}?text=${encodeURIComponent(msg(r))}">WhatsApp</a>
            ${r.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(p?.title || '')}&body=${encodeURIComponent(msg(r))}">Email</a>` : ''}
          </span></div>`).join('')}</div>`, 600);
    m.querySelector('#pp-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); ui.showToast(T('Link copiato', 'Link copied'), 'success'); }
      catch (_) { m.querySelector('#pp-link').select(); document.execCommand('copy'); }
    };
  }

  // ── Firma di controfirma ──────────────────────────────────
  function signaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1a5c';
    let drawing = false, dirty = false, last = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return; const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
      isEmpty: () => !dirty,
      png: () => canvas.toDataURL('image/png').split(',')[1],
    };
  }

  function openCountersignSetup(after) {
    const me = sb.getCurrentProfile();
    const m = modal(T('La tua firma per le controfirme', 'Your countersignature'), `
      <div class="form-row">
        <div class="form-group"><label class="form-label">${T('Nome sul documento', 'Name on document')}</label>
          <input class="form-control" id="cs-name" value="${esc(cfg?.countersignature?.display_name || me?.full_name || '')}"></div>
        <div class="form-group"><label class="form-label">${T('Ruolo (facoltativo)', 'Title (optional)')}</label>
          <input class="form-control" id="cs-role" value="${esc(cfg?.countersignature?.role_title || '')}" placeholder="Managing Director"></div>
      </div>
      <label class="form-label">${T('Disegna la firma', 'Draw your signature')}</label>
      <canvas id="cs-pad" style="width:100%;height:160px;border:1.5px dashed var(--border);border-radius:10px;touch-action:none;background:#fff"></canvas>
      <button class="btn btn-ghost btn-sm" id="cs-clear" style="margin-top:6px">${T('Cancella', 'Clear')}</button>`, 560,
      `<button class="btn btn-ghost" data-close>${T('Annulla', 'Cancel')}</button><button class="btn btn-accent" id="cs-save">${T('Salva firma', 'Save signature')}</button>`);
    const pad = signaturePad(m.querySelector('#cs-pad'));
    m.querySelector('#cs-clear').onclick = () => pad.clear();
    m.querySelector('#cs-save').onclick = async () => {
      if (pad.isEmpty()) return ui.showToast(T('Disegna la firma', 'Draw your signature'), 'error');
      try {
        await call('save_countersignature', { png_base64: pad.png(), display_name: m.querySelector('#cs-name').value, role_title: m.querySelector('#cs-role').value });
        cfg = await call('config');
        m.remove(); ui.showToast(T('Firma salvata', 'Signature saved'), 'success'); render();
        if (typeof after === 'function') after();
      } catch (e) { ui.showToast(e.message, 'error'); }
    };
  }

  // ── Nuova proposta ────────────────────────────────────────
  function recipientRow(r = {}, i = 0) {
    return `<div class="pp-rec" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
      <div class="form-row" style="margin-bottom:6px">
        <input class="form-control" data-k="full_name" placeholder="${T('Nome e cognome', 'Full name')}" value="${esc(r.full_name || '')}">
        <input class="form-control" data-k="phone" placeholder="+971 50 123 4567" value="${esc(r.phone || '')}" inputmode="tel">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-control" data-k="email" placeholder="email@esempio.com" value="${esc(r.email || '')}" style="flex:1">
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap"><input type="checkbox" data-k="can_sign" ${r.can_sign !== false ? 'checked' : ''}> ${T('Può firmare', 'Can sign')}</label>
        ${i > 0 ? `<button class="btn btn-ghost btn-sm" onclick="this.closest('.pp-rec').remove()">✕</button>` : ''}
      </div></div>`;
  }

  function openNew() {
    const c = (typeof clientData !== 'undefined' && clientData) || {};
    const m = modal(T('Nuova proposta', 'New proposal'), `
      <div id="pp-step1">
        <div class="form-group"><label class="form-label">PDF ${T('della proposta', 'of the proposal')}</label>
          <input type="file" accept="application/pdf" id="pp-file" class="form-control"></div>
        <div id="pp-ai" style="font-size:12px;color:var(--text-muted)"></div>
      </div>
      <div id="pp-step2" style="display:none">
        <div class="form-group"><label class="form-label">${T('Titolo', 'Title')}</label><input class="form-control" id="pp-title"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">${T('Importo', 'Amount')}</label><input class="form-control" id="pp-amount" inputmode="decimal"></div>
          <div class="form-group"><label class="form-label">${T('Valuta', 'Currency')}</label><input class="form-control" id="pp-currency" value="AED" maxlength="3"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">${T('Lingua per il cliente', 'Client language')}</label>
            <select class="form-control" id="pp-locale"><option value="it">Italiano</option><option value="en">English</option></select></div>
          <div class="form-group"><label class="form-label">${T('Scadenza (giorni)', 'Expiry (days)')}</label><input class="form-control" id="pp-days" type="number" min="1" max="365" value="14"></div>
        </div>
        <label class="form-label">${T('Destinatari', 'Recipients')}</label>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${T('Ognuno entra con il proprio numero. Basta la firma di uno dei firmatari.', 'Each one enters with their own number. One signer\'s signature is enough.')}
          ${cfg?.recipients_need_email ? '<br><b>' + T('I codici partono per email: serve l\'email di ogni destinatario.', 'Codes are sent by email: each recipient needs an email.') + '</b>' : ''}</div>
        <div id="pp-recs"></div>
        <button class="btn btn-ghost btn-sm" id="pp-add">+ ${T('Aggiungi destinatario (es. socio)', 'Add recipient (e.g. partner)')}</button>
        <div id="pp-notes" style="font-size:12px;color:var(--warning);margin-top:10px"></div>
        <div id="pp-progress" style="font-size:13px;margin-top:12px"></div>
      </div>`, 680,
      `<button class="btn btn-ghost" data-close>${T('Annulla', 'Cancel')}</button><button class="btn btn-accent" id="pp-submit" disabled>${T('Crea e attiva il link', 'Create and activate link')}</button>`);

    const $ = (s) => m.querySelector(s);
    let file = null, pdf = null, extraction = null;

    $('#pp-add').onclick = () => $('#pp-recs').insertAdjacentHTML('beforeend', recipientRow({ can_sign: false }, 1));

    $('#pp-file').onchange = async (ev) => {
      file = ev.target.files[0];
      if (!file) return;
      if (file.size > MAX_PDF_MB * 1024 * 1024) { ui.showToast(`PDF ${T('oltre', 'over')} ${MAX_PDF_MB} MB`, 'error'); return; }
      $('#pp-ai').innerHTML = `<div class="spinner" style="display:inline-block;width:14px;height:14px;vertical-align:middle"></div> ${T('Leggo il PDF con l\'AI…', 'Reading the PDF with AI…')}`;
      const b64 = await fileToBase64(file);
      const [lib, ai] = await Promise.all([
        loadPdfJs(),
        call('extract', { pdf_base64: b64 }).catch((e) => ({ _error: e.message })),
      ]);
      try { pdf = await lib.getDocument({ data: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) }).promise; }
      catch (e) { $('#pp-ai').textContent = T('PDF non leggibile', 'Unreadable PDF') + ': ' + e.message; return; }
      extraction = ai && !ai._error ? ai : null;
      const x = extraction || {};
      $('#pp-ai').innerHTML = ai._error
        ? `⚠ ${esc(ai._error)} — ${T('compila i dati a mano.', 'fill in the data manually.')}`
        : `✓ ${T('Dati proposti dall\'AI: controllali e correggili prima di inviare.', 'AI-suggested data: check and correct before sending.')} (${pdf.numPages} ${T('pagine', 'pages')})`;
      $('#pp-title').value = x.title || file.name.replace(/\.pdf$/i, '');
      $('#pp-amount').value = x.amount ?? '';
      $('#pp-currency').value = x.currency || 'AED';
      $('#pp-locale').value = x.language || 'it';
      $('#pp-recs').innerHTML = recipientRow({
        full_name: x.client_name || c.contact_name || c.company_name || '',
        phone: x.phone_e164 || c.phone_uae || '',
        email: x.email || c.email || '',
        can_sign: true,
      }, 0);
      $('#pp-notes').textContent = x.notes || '';
      $('#pp-step2').style.display = 'block';
      $('#pp-submit').disabled = false;
    };

    $('#pp-submit').onclick = async () => {
      const recipients = [...m.querySelectorAll('.pp-rec')].map((row) => ({
        full_name: row.querySelector('[data-k=full_name]').value.trim(),
        phone: row.querySelector('[data-k=phone]').value.trim(),
        email: row.querySelector('[data-k=email]').value.trim(),
        can_sign: row.querySelector('[data-k=can_sign]').checked,
      }));
      const btn = $('#pp-submit'); btn.disabled = true;
      const prog = $('#pp-progress');
      let id = null;
      try {
        prog.textContent = T('Creo la proposta…', 'Creating proposal…');
        const created = await call('create', {
          client_id: clientId,
          title: $('#pp-title').value,
          amount: $('#pp-amount').value.replace(',', '.'),
          currency: $('#pp-currency').value.toUpperCase(),
          locale: $('#pp-locale').value,
          expires_in_days: Number($('#pp-days').value),
          recipients,
          pdf_base64: await fileToBase64(file),
          pdf_name: file.name,
          page_count: pdf.numPages,
          ai_extraction: extraction,
        });
        id = created.id;
        for (let n = 1; n <= pdf.numPages; n++) {
          prog.textContent = `${T('Converto e carico la pagina', 'Converting and uploading page')} ${n}/${pdf.numPages}…`;
          const pg = await renderPage(pdf, n);
          await call('add_page', { id, n, jpeg_base64: pg.b64, w: pg.w, h: pg.h });
        }
        prog.textContent = T('Attivo il link…', 'Activating link…');
        const pub = await call('publish', { id });
        m.remove();
        await load();
        ui.showToast(T('Proposta inviata in pipeline', 'Proposal sent to pipeline'), 'success');
        await shareDialog(pub.link, list.find((p) => p.id === id));
      } catch (e) {
        prog.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
        if (id) { try { await call('delete_draft', { id }); } catch (_) {} }
        btn.disabled = false;
      }
    };
  }

  window.Proposte = { load, openNew, copyLink, extend, revoke, regenerate, deleteDraft, preview, openFinal, countersign, openCountersignSetup, toggleTimeline };

  // Apertura diretta dalla notifica: /client-detail.html?id=..&tab=proposte
  document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('tab') !== 'proposte') return;
    const tryOpen = (n = 0) => {
      const btn = document.getElementById('tab-btn-proposte');
      if (btn && typeof clientData !== 'undefined' && clientData) btn.click();
      else if (n < 40) setTimeout(() => tryOpen(n + 1), 150);
    };
    tryOpen();
  });
})();
