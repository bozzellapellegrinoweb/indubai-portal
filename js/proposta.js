// ============================================================
// Pagina pubblica della proposta (/p/<token>) — nessun login del portale.
// Parla solo con la Edge Function proposal-public.
// ============================================================
(function () {
  'use strict';

  const FN = `${window.ENV_SUPABASE_URL}/functions/v1/proposal-public`;
  const token = (location.pathname.match(/\/p\/([A-Za-z0-9_-]{40,64})/) || [])[1]
    || new URLSearchParams(location.search).get('t') || '';
  const SKEY = 'pbtax_proposal_session_' + token.slice(0, 12);

  const I18N = {
    it: {
      phone_title: 'Apri la tua proposta',
      phone_lead: 'Inserisci il numero di telefono che ci hai comunicato. Ti mandiamo un codice di accesso a sei cifre.',
      phone_label: 'Numero di telefono, con prefisso internazionale',
      phone_btn: 'Ricevi il codice',
      privacy: 'Privacy: per proteggere il documento usiamo il tuo numero di telefono, l\'indirizzo IP, il tipo di dispositivo e la data e l\'ora di ogni accesso. Li conserva PB TAX International Tax Consultants FZCO solo come prova di consegna e di firma della proposta, per il tempo previsto dalla legge. Puoi chiedere informazioni o la cancellazione scrivendo a info@indubai.it.',
      code_title: 'Inserisci il codice',
      code_lead: 'Se il numero è registrato su questa proposta, ti abbiamo appena inviato un codice di sei cifre (WhatsApp, SMS o email). Vale 10 minuti.',
      code_btn: 'Apri la proposta',
      resend: 'Invia un nuovo codice', resend_wait: 'Nuovo codice tra {s} s',
      change_number: 'Cambia numero',
      sign_cta: 'Accetto e firmo',
      sign_title: 'Firma la proposta',
      sign_typed: 'Scrivi', sign_drawn: 'Disegna',
      sign_name: 'Nome e cognome',
      clear: 'Cancella',
      sign_confirm: 'Confermo e firmo',
      foot: 'Documento riservato. Copia, stampa e salvataggio sono disabilitati.',
      logout: 'Esci',
      for: 'Proposta per',
      expires: 'Valida fino al', pages: 'pagine',
      signed_by: 'Firmata da {n} il {d}.',
      signed_ok: 'Grazie, la proposta è firmata. Ricevi il documento finale per email dopo la controfirma di PB TAX.',
      state_invalid: ['Link non valido', 'Controlla di aver aperto il link completo che ti abbiamo mandato.'],
      state_expired: ['Proposta scaduta', 'Il link è scaduto. Scrivici e ti mandiamo una proposta aggiornata.'],
      state_revoked: ['Link non più attivo', 'Questo link è stato disattivato. Scrivici per ricevere quello nuovo.'],
      state_completed: ['Proposta completata', 'La proposta è firmata e controfirmata. Il documento finale ti è arrivato per email.'],
      session_expired: 'Sessione scaduta dopo 30 minuti di inattività. Inserisci di nuovo il numero.',
      bad_phone: 'Inserisci il numero con il prefisso internazionale, per esempio +971 50 123 4567.',
      need_sig: 'Scrivi nome e cognome oppure disegna la firma.',
      generic: 'Qualcosa non ha funzionato. Riprova.',
      loading_page: 'Caricamento…',
    },
    en: {
      phone_title: 'Open your proposal',
      phone_lead: 'Enter the phone number you gave us. We will send you a six-digit access code.',
      phone_label: 'Phone number, with international prefix',
      phone_btn: 'Get the code',
      privacy: 'Privacy: to protect the document we use your phone number, IP address, device type and the date and time of each access. PB TAX International Tax Consultants FZCO keeps them only as evidence of delivery and signature of the proposal, for the period required by law. For information or deletion write to info@indubai.it.',
      code_title: 'Enter the code',
      code_lead: 'If the number is registered on this proposal, we have just sent you a six-digit code (WhatsApp, SMS or email). It is valid for 10 minutes.',
      code_btn: 'Open the proposal',
      resend: 'Send a new code', resend_wait: 'New code in {s} s',
      change_number: 'Change number',
      sign_cta: 'I accept and sign',
      sign_title: 'Sign the proposal',
      sign_typed: 'Type', sign_drawn: 'Draw',
      sign_name: 'Full name',
      clear: 'Clear',
      sign_confirm: 'Confirm and sign',
      foot: 'Confidential document. Copying, printing and saving are disabled.',
      logout: 'Sign out',
      for: 'Proposal for',
      expires: 'Valid until', pages: 'pages',
      signed_by: 'Signed by {n} on {d}.',
      signed_ok: 'Thank you, the proposal is signed. You will receive the final document by email after PB TAX countersigns it.',
      state_invalid: ['Invalid link', 'Make sure you opened the full link we sent you.'],
      state_expired: ['Proposal expired', 'This link has expired. Write to us and we will send an updated proposal.'],
      state_revoked: ['Link no longer active', 'This link has been disabled. Write to us to receive the new one.'],
      state_completed: ['Proposal completed', 'The proposal is signed and countersigned. The final document was sent to you by email.'],
      session_expired: 'Session expired after 30 minutes of inactivity. Enter your number again.',
      bad_phone: 'Enter the number with the international prefix, e.g. +971 50 123 4567.',
      need_sig: 'Type your full name or draw your signature.',
      generic: 'Something went wrong. Please try again.',
      loading_page: 'Loading…',
    },
  };

  let lang = 'it';
  try { lang = localStorage.getItem('pbtax_lang') || ((navigator.language || '').startsWith('it') ? 'it' : 'en'); } catch (_) {}
  const t = (k, vars) => {
    let s = (I18N[lang] || I18N.it)[k] ?? I18N.it[k] ?? k;
    if (vars && typeof s === 'string') for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b);
    return s;
  };
  const $ = (id) => document.getElementById(id);

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    if (view) renderDoc();
    updateResend();
  }
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
    lang = b.dataset.lang; try { localStorage.setItem('pbtax_lang', lang); } catch (_) {}
    applyLang();
  }));

  // ── Identificativo del dispositivo (solo informativo) ──────
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('pbtax_device') || '';
    if (!deviceId) {
      deviceId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('pbtax_device', deviceId);
    }
  } catch (_) { deviceId = ''; }

  let session = '';
  try { session = sessionStorage.getItem(SKEY) || ''; } catch (_) {}
  const saveSession = (s) => { session = s; try { s ? sessionStorage.setItem(SKEY, s) : sessionStorage.removeItem(SKEY); } catch (_) {} };

  async function api(action, body = {}) {
    const r = await fetch(FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', apikey: window.ENV_SUPABASE_ANON_KEY,
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        ...(session ? { 'x-proposal-session': session } : {}),
      },
      body: JSON.stringify({ action, token, ...body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || t('generic')); e.code = d.code; e.status = r.status; throw e; }
    return d;
  }

  function show(id) {
    ['v-loading', 'v-state', 'v-phone', 'v-code', 'v-doc'].forEach((v) => $(v).classList.toggle('hid', v !== id));
    window.scrollTo(0, 0);
  }
  function msg(id, text, kind = 'bad') {
    const el = $(id);
    if (!text) { el.classList.add('hid'); return; }
    el.className = 'msg ' + kind; el.textContent = text;
  }
  function showState(state) {
    const pair = t('state_' + state);
    const [a, b] = Array.isArray(pair) ? pair : t('state_invalid');
    $('state-title').textContent = a; $('state-body').textContent = b;
    show('v-state');
  }

  // ── 1. Numero ──────────────────────────────────────────────
  let phone = '';
  let resendAt = 0, resendTimer = null;

  function normalize(v) {
    let s = String(v || '').replace(/[\s().\-/]/g, '');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    return /^\+[1-9][0-9]{6,14}$/.test(s) ? s : null;
  }

  async function requestCode() {
    const d = await api('request_code', { phone, locale: lang });
    resendAt = Date.now() + (d.retry_after || 60) * 1000;
    updateResend();
  }

  $('f-phone').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = normalize($('phone').value);
    if (!p) return msg('phone-msg', t('bad_phone'));
    msg('phone-msg', ''); $('phone-btn').disabled = true;
    try {
      phone = p; await requestCode();
      $('code-lead').textContent = t('code_lead');
      $('code').value = ''; msg('code-msg', '');
      show('v-code'); $('code').focus();
    } catch (err) {
      if (err.status === 410) return showState(err.code);
      msg('phone-msg', err.message);
    } finally { $('phone-btn').disabled = false; }
  });

  function updateResend() {
    const btn = $('resend');
    clearTimeout(resendTimer);
    const left = Math.ceil((resendAt - Date.now()) / 1000);
    if (left > 0) {
      btn.disabled = true; btn.textContent = t('resend_wait', { s: left });
      resendTimer = setTimeout(updateResend, 1000);
    } else { btn.disabled = false; btn.textContent = t('resend'); }
  }
  $('resend').addEventListener('click', async () => {
    try { await requestCode(); msg('code-msg', ''); } catch (err) { msg('code-msg', err.message); }
  });
  $('change').addEventListener('click', () => { show('v-phone'); $('phone').focus(); });

  // ── 2. Codice ──────────────────────────────────────────────
  $('code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) $('f-code').requestSubmit();
  });
  $('f-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('code').value;
    if (code.length !== 6) return;
    $('code-btn').disabled = true; msg('code-msg', '');
    try {
      const d = await api('verify_code', { phone, code });
      saveSession(d.session_token);
      openDoc(d);
    } catch (err) {
      if (err.status === 410) return showState(err.code);
      msg('code-msg', err.message); $('code').value = '';
    } finally { $('code-btn').disabled = false; }
  });

  // ── 3. Documento ───────────────────────────────────────────
  let view = null;
  let lastActivity = Date.now(), hbTimer = null, reachedEnd = false;

  function fmtDate(d) {
    return new Date(d).toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderDoc() {
    const p = view.proposal;
    $('doc-for').textContent = `${t('for')} ${p.client_name || view.viewer.name}`;
    $('doc-title').textContent = p.title;
    $('doc-amount').textContent = p.amount == null ? '' : p.amount_label;
    $('doc-meta').innerHTML = '';
    [`${t('expires')} ${fmtDate(p.expires_at)}`, `${p.pages.length} ${t('pages')}`, `${view.viewer.name} · ${view.viewer.phone_masked}`]
      .forEach((s) => { const sp = document.createElement('span'); sp.textContent = s; $('doc-meta').appendChild(sp); });
    if (view.signature) {
      $('doc-signed').textContent = t('signed_by', { n: view.signature.signer_name, d: view.signature.signed_at_dubai });
      $('doc-signed').classList.remove('hid');
    } else $('doc-signed').classList.add('hid');
    $('sign-cta').classList.toggle('hid', !view.can_sign_now || !$('sign-box').classList.contains('hid'));
    $('consent-text').textContent = view.consent.text;
  }

  function openDoc(d) {
    view = d;
    renderDoc();
    const box = $('pages'); box.innerHTML = '';
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); loadPage(en.target); } });
    }, { rootMargin: '600px 0px' });
    view.proposal.pages.forEach((pg) => {
      const div = document.createElement('div');
      div.className = 'page'; div.dataset.n = pg.n;
      div.style.aspectRatio = `${pg.w} / ${pg.h}`;
      div.innerHTML = `<div class="ph">${t('loading_page')}</div>`;
      box.appendChild(div); io.observe(div);
    });
    // Letta fino in fondo: l'ultima pagina è entrata a schermo.
    const last = box.lastElementChild;
    if (last) new IntersectionObserver((en, o) => {
      if (en[0].isIntersecting && !reachedEnd) { reachedEnd = true; o.disconnect(); api('heartbeat', { reached_end: true }).catch(onSessionError); }
    }, { threshold: 0.6 }).observe(last);
    show('v-doc');
    startHeartbeat();
  }

  async function loadPage(div) {
    try {
      const r = await fetch(`${FN}?action=page&n=${div.dataset.n}`, {
        headers: { apikey: window.ENV_SUPABASE_ANON_KEY, 'x-proposal-session': session, ...(deviceId ? { 'x-device-id': deviceId } : {}) },
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); const e = new Error(d.error); e.status = r.status; e.code = d.code; throw e; }
      // Disegnata su canvas: nessun <img> con un indirizzo da salvare.
      const bmp = await createImageBitmap(await r.blob());
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      div.innerHTML = ''; div.appendChild(c);
    } catch (e) { onSessionError(e); }
  }

  function onSessionError(e) {
    if (e && (e.status === 401)) {
      saveSession(''); view = null; stopHeartbeat();
      show('v-phone'); msg('phone-msg', t('session_expired'), 'warn');
    } else if (e && e.status === 410) { stopHeartbeat(); showState(e.code); }
  }

  // Inattivita': la sessione la chiude il server dopo 30 minuti; qui si
  // rinnova solo se la persona sta davvero usando la pagina.
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(() => {
      if (!session) return;
      if (Date.now() - lastActivity < 2 * 60_000) api('heartbeat').catch(onSessionError);
      else if (Date.now() - lastActivity > 30 * 60_000) onSessionError({ status: 401 });
    }, 60_000);
  }
  function stopHeartbeat() { clearInterval(hbTimer); hbTimer = null; }

  $('logout').addEventListener('click', async () => {
    try { await api('logout'); } catch (_) {}
    saveSession(''); view = null; stopHeartbeat(); show('v-phone');
  });

  // ── 4. Firma ───────────────────────────────────────────────
  let method = 'typed';
  $('open-sign').addEventListener('click', () => {
    $('sign-box').classList.remove('hid'); $('sign-cta').classList.add('hid');
    $('typed-name').value = $('typed-name').value || (view?.viewer?.name || '');
    $('typed-preview').textContent = $('typed-name').value;
    $('sign-box').scrollIntoView({ behavior: 'smooth' });
    initPad(); validate();
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.m;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('m-typed').classList.toggle('hid', method !== 'typed');
    $('m-drawn').classList.toggle('hid', method !== 'drawn');
    if (method === 'drawn') initPad();
    validate();
  }));
  $('typed-name').addEventListener('input', (e) => { $('typed-preview').textContent = e.target.value; validate(); });
  $('consent').addEventListener('change', validate);

  let pad = null;
  function initPad() {
    const c = $('pad');
    if (pad || c.offsetWidth === 0) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d'); ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1a5c';
    let down = false, last = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => { down = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
    c.addEventListener('pointermove', (e) => {
      if (!down) return; const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; pad.strokes++; validate();
    });
    ['pointerup', 'pointercancel'].forEach((t2) => c.addEventListener(t2, () => { down = false; }));
    pad = { strokes: 0, clear() { ctx.clearRect(0, 0, c.width, c.height); this.strokes = 0; validate(); } };
  }
  $('pad-clear').addEventListener('click', () => pad && pad.clear());

  function sigReady() {
    return method === 'typed' ? $('typed-name').value.trim().length >= 3 : !!(pad && pad.strokes > 15);
  }
  function validate() { $('sign-btn').disabled = !($('consent').checked && sigReady()); }

  $('sign-btn').addEventListener('click', async () => {
    if (!sigReady()) return msg('sign-msg', t('need_sig'));
    $('sign-btn').disabled = true; msg('sign-msg', '');
    try {
      const body = { method, consent: $('consent').checked };
      if (method === 'typed') body.typed_name = $('typed-name').value.trim();
      else body.drawn_png = $('pad').toDataURL('image/png').split(',')[1];
      await api('sign', body);
      $('sign-box').classList.add('hid');
      view = await api('view');
      renderDoc();
      $('doc-signed').textContent = t('signed_ok');
      $('doc-signed').classList.remove('hid');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.status === 401 || err.status === 410) return onSessionError(err);
      msg('sign-msg', err.message); validate();
    }
  });

  // ── Protezioni (deterrenti: lo screenshot non si può impedire,
  //    per questo la filigrana è impressa nelle immagini) ────────
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'a', 'u', 'x'].includes(k) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    if (k === 'printscreen') { try { navigator.clipboard.writeText(''); } catch (_) {} }
  });
  ['copy', 'cut', 'dragstart', 'selectstart'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  }));
  window.addEventListener('beforeprint', () => { document.body.style.display = 'none'; });
  window.addEventListener('afterprint', () => { document.body.style.display = ''; });

  // ── Avvio ──────────────────────────────────────────────────
  (async function boot() {
    applyLang();
    if (!token) return showState('invalid');
    if (session) {
      try { openDoc(await api('view')); return; } catch (_) { saveSession(''); }
    }
    try {
      const info = await api('info');
      let chosen = null;
      try { chosen = localStorage.getItem('pbtax_lang'); } catch (_) {}
      if (!chosen && info.locale) { lang = info.locale; applyLang(); }
      if (info.state !== 'ok') return showState(info.state);
      show('v-phone');
    } catch (_) { showState('invalid'); }
  })();
})();
