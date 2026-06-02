// ============================================================
// InDubai Portal — i18n Lightweight Translation (IT / EN)
// Default: IT — toggle saved in localStorage
// ============================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'indubai_lang';

  // ── Translation dictionary IT → EN ──────────────────────────
  const dict = {
    // Sidebar / Nav
    'Dashboard': 'Dashboard',
    'Task': 'Tasks',
    'Notifiche': 'Notifications',
    'Clienti': 'Clients',
    '↳ Setup Zoho': '↳ Zoho Setup',
    '↳ Monitor VAT': '↳ VAT Monitor',
    'Documenti': 'Documents',
    'Onboarding': 'Onboarding',
    'Estratti Conto': 'Bank Statements',
    'Abbonamenti': 'Subscriptions',
    'Bilanci': 'Financial Statements',
    'Ferie & Permessi': 'Leave & Time Off',
    'VAT Register': 'VAT Register',
    'Corporate Tax': 'Corporate Tax',
    'Affinitas': 'Affinitas',
    'Report': 'Reports',
    'UAE News': 'UAE News',
    'Ricerca': 'Search',
    'Utenti': 'Users',
    'Attività Staff': 'Staff Activity',

    // Sidebar footer
    'Amministratore': 'Administrator',
    'Senior': 'Senior',
    'Junior': 'Junior',
    'Mini Admin': 'Mini Admin',
    'Collaboratore': 'Collaborator',

    // Common buttons
    'Salva': 'Save',
    'Modifica': 'Edit',
    'Elimina': 'Delete',
    'Annulla': 'Cancel',
    'Cerca': 'Search',
    'Filtra': 'Filter',
    'Aggiungi': 'Add',
    'Carica': 'Upload',
    'Scarica': 'Download',
    'Esporta': 'Export',
    'Chiudi': 'Close',
    'Conferma': 'Confirm',
    'Invia': 'Send',
    'Aggiorna': 'Update',
    'Applica': 'Apply',
    'Indietro': 'Back',
    'Avanti': 'Next',
    'Copia': 'Copy',
    'Ricarica': 'Reload',

    // Common labels
    'Nome': 'Name',
    'Cognome': 'Last Name',
    'Email': 'Email',
    'Telefono': 'Phone',
    'Stato': 'Status',
    'Data': 'Date',
    'Scadenza': 'Deadline',
    'Priorità': 'Priority',
    'Assegnato a': 'Assigned to',
    'Creato da': 'Created by',
    'Descrizione': 'Description',
    'Note': 'Notes',
    'Allegati': 'Attachments',
    'Commenti': 'Comments',
    'Titolo': 'Title',
    'Cliente': 'Client',
    'Tipo': 'Type',
    'Periodo': 'Period',
    'Importo': 'Amount',
    'Valore': 'Value',
    'Totale': 'Total',
    'Dettagli': 'Details',
    'Azioni': 'Actions',

    // Task statuses
    'Aperta': 'Open',
    'Aperte': 'Open',
    'In corso': 'In Progress',
    'Completata': 'Completed',
    'Completate': 'Completed',
    'Fatta': 'Done',
    'Annullata': 'Cancelled',
    'Da fare': 'To Do',

    // Priority
    'Urgente': 'Urgent',
    'Alta': 'High',
    'Normale': 'Normal',
    'Bassa': 'Low',

    // Task page
    'Nuova Task': 'New Task',
    '+ Nuova Task': '+ New Task',
    'Tutte': 'All',
    'Seleziona una task': 'Select a task',
    'Nessuna task qui': 'No tasks here',
    'Nessun commento.': 'No comments.',
    'Scrivi un commento...': 'Write a comment...',
    'Caricamento file...': 'Uploading file...',
    'Nuovo commento': 'New comment',

    // Client page
    'Nuovo Cliente': 'New Client',
    '+ Nuovo Cliente': '+ New Client',
    'Clienti attivi': 'Active Clients',
    'Nessun cliente trovato': 'No client found',
    'Ragione sociale': 'Company Name',
    'Licenza commerciale': 'Trade License',
    'Partita IVA': 'VAT Number',
    'TRN': 'TRN',
    'Indirizzo': 'Address',
    'Referente': 'Contact Person',
    'Settore': 'Sector',
    'Attivo': 'Active',
    'In bilancio': 'In Balance',
    'Freelancer': 'Freelancer',

    // Dashboard
    'Panoramica': 'Overview',
    'Scadenze': 'Deadlines',
    'Entrate': 'Revenue',
    'Pagamenti': 'Payments',
    'Task aperte': 'Open Tasks',
    'Task completate': 'Completed Tasks',
    'Clienti totali': 'Total Clients',
    'Nessuna scadenza': 'No deadlines',
    'Caricamento...': 'Loading...',
    'Caricamento dati...': 'Loading data...',
    'Nessun dato': 'No data',
    'Nessun risultato': 'No results',
    'Nessun risultato trovato': 'No results found',

    // Notification panel
    'Nessuna notifica': 'No notifications',
    'Segna lette': 'Mark all read',
    'Vedi tutte →': 'View all →',
    'Vedi tutte': 'View all',
    'Tutte lette': 'All read',
    'Aggiornamento...': 'Refreshing...',

    // Status / Messages
    'Errore': 'Error',
    'Successo': 'Success',
    'Operazione riuscita': 'Operation successful',
    'Operazione fallita': 'Operation failed',
    'Sei sicuro?': 'Are you sure?',
    'Salvataggio...': 'Saving...',
    'Salvato!': 'Saved!',
    'Salvato con successo': 'Saved successfully',
    'Errore durante il salvataggio': 'Error while saving',
    'Conferma eliminazione': 'Confirm deletion',

    // Months
    'Gennaio': 'January',
    'Febbraio': 'February',
    'Marzo': 'March',
    'Aprile': 'April',
    'Maggio': 'May',
    'Giugno': 'June',
    'Luglio': 'July',
    'Agosto': 'August',
    'Settembre': 'September',
    'Ottobre': 'October',
    'Novembre': 'November',
    'Dicembre': 'December',

    // Days
    'Lunedì': 'Monday',
    'Martedì': 'Tuesday',
    'Mercoledì': 'Wednesday',
    'Giovedì': 'Thursday',
    'Venerdì': 'Friday',
    'Sabato': 'Saturday',
    'Domenica': 'Sunday',

    // Time
    'oggi': 'today',
    'ieri': 'yesterday',
    'domani': 'tomorrow',
    'giorni fa': 'days ago',
    'ore fa': 'hours ago',
    'minuti fa': 'minutes ago',

    // Sections
    'OVERVIEW': 'OVERVIEW',
    'GESTIONE': 'MANAGEMENT',
    'COMPLIANCE': 'COMPLIANCE',
    'ANALYTICS': 'ANALYTICS',
    'ADMIN': 'ADMIN',

    // Task page sections
    'VISTA': 'VIEW',
    'STATO': 'STATUS',
    'CATEGORIA': 'CATEGORY',
    'Clicca su una task per vedere i dettagli': 'Click on a task to see details',
    'task attive': 'active tasks',
    'Pagamenti': 'Payments',
    'Estratti': 'Statements',

    // Documents
    'Carica documento': 'Upload document',
    'Nessun documento': 'No documents',
    'Scarica tutto': 'Download all',
    'Cartella': 'Folder',
    'File': 'File',

    // Payments / Subscriptions
    'Pagato': 'Paid',
    'Non pagato': 'Unpaid',
    'In attesa': 'Pending',
    'Scaduto': 'Overdue',
    'Non tentato': 'Not attempted',
    'Rifiutato': 'Declined',
    'Parziale': 'Partial',
    'Gratuito': 'Free',
    'Mensile': 'Monthly',
    'Annuale': 'Yearly',
    'Trimestrale': 'Quarterly',

    // Leave / Ferie
    'Ferie': 'Vacation',
    'Permesso': 'Leave',
    'Malattia': 'Sick Leave',
    'Approvato': 'Approved',
    'Rifiutato': 'Rejected',
    'In revisione': 'Under Review',
    'Richiedi ferie': 'Request Leave',
    'Giorni rimanenti': 'Remaining Days',
    'Invia richiesta': 'Submit Request',

    // Onboarding
    'Nuovo onboarding': 'New Onboarding',
    'Passo': 'Step',
    'Completamento': 'Completion',

    // Statements
    'Estratti conto': 'Bank Statements',
    'Mancanti': 'Missing',
    'Ricevuti': 'Received',
    'Caricato': 'Uploaded',
    'Non caricato': 'Not uploaded',

    // VAT
    'Registro IVA': 'VAT Register',
    'Dichiarazione IVA': 'VAT Return',
    'Importo IVA': 'VAT Amount',
    'Scadenza VAT': 'VAT Deadline',

    // Reports
    'Genera report': 'Generate Report',
    'Scarica report': 'Download Report',

    // Search
    'Cerca nel portale...': 'Search the portal...',
    'Risultati': 'Results',
    'Nessun risultato per': 'No results for',

    // Users
    'Gestione Utenti': 'User Management',
    'Nuovo Utente': 'New User',
    '+ Nuovo Utente': '+ New User',
    'Cambia Password': 'Change Password',
    'Cambia la mia password': 'Change my password',
    'Aggiorna la password di accesso': 'Update your login password',
    'Permessi per Ruolo': 'Role Permissions',
    'Gestisci quali sezioni può vedere ogni ruolo. Admin vede sempre tutto.': 'Manage which sections each role can see. Admin always sees everything.',
    'Salva Permessi': 'Save Permissions',
    'Reset predefiniti': 'Reset Defaults',
    'tutte le sezioni': 'all sections',
    'Creato': 'Created',

    // Login
    'Accedi': 'Sign In',
    'Password': 'Password',
    'Ricordami': 'Remember Me',
    'Password dimenticata?': 'Forgot Password?',

    // Mobile
    'Home': 'Home',
    'Menu': 'Menu',
    "Esci dall'account": 'Sign Out',

    // Misc
    'Nessuno': 'None',
    '— Nessuno —': '— None —',
    'Tutti': 'All',
    'Tutto': 'All',
    'Altro': 'Other',
    'Sì': 'Yes',

    // Bilanci
    'Anno fiscale': 'Fiscal Year',
    'Approvazione': 'Approval',

    // Corp Tax
    'Scadenza CT': 'CT Deadline',

    // Common table/grid headers
    'Azienda': 'Company',
    'Contatto': 'Contact',
    'Ultima modifica': 'Last Modified',
    'Data creazione': 'Creation Date',
    'Creato il': 'Created on',
    'Aggiornato il': 'Updated on',
    'Scade il': 'Expires on',
    'Scade tra': 'Expires in',
    'Nessuna azione richiesta': 'No action required',

    // Common compound phrases
    'Attività recenti': 'Recent Activity',
    'Ultime modifiche': 'Latest Changes',
    'Carica file': 'Upload File',
    'Trascina qui': 'Drag here',
    'o clicca per caricare': 'or click to upload',
  };

  // Build reverse dictionary (EN → IT) for toggling back
  const reverseDict = {};
  for (const [it, en] of Object.entries(dict)) {
    if (it !== en) reverseDict[en] = it;
  }

  // Sort keys by length descending so longer phrases match first
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  const sortedReverseKeys = Object.keys(reverseDict).sort((a, b) => b.length - a.length);

  // ── Core translation functions ──────────────────────────────

  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || 'it';
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
  }

  function isEN() {
    return getLang() === 'en';
  }

  /** Translate a single string */
  function t(text) {
    if (!isEN()) return text;
    return dict[text] || text;
  }

  /** Translate string from EN back to IT */
  function tReverse(text) {
    return reverseDict[text] || text;
  }

  // ── DOM Translation ─────────────────────────────────────────

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'SVG', 'CANVAS', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'NOSCRIPT']);

  function shouldSkip(node) {
    if (!node) return true;
    if (node.nodeType === 1 && SKIP_TAGS.has(node.tagName)) return true;
    // Skip elements with data-no-i18n attribute
    if (node.nodeType === 1 && node.hasAttribute('data-no-i18n')) return true;
    return false;
  }

  function translateTextNode(node, keys, dictionary) {
    const original = node.textContent;
    if (!original || !original.trim()) return;
    const trimmed = original.trim();

    // Exact match first (most reliable)
    if (dictionary[trimmed]) {
      // Preserve leading/trailing whitespace
      const leading = original.match(/^\s*/)[0];
      const trailing = original.match(/\s*$/)[0];
      node.textContent = leading + dictionary[trimmed] + trailing;
      return;
    }

    // Partial match for longer text containing translatable phrases
    let changed = original;
    for (const key of keys) {
      if (key.length < 6) continue; // Skip short words to avoid false matches inside other words
      if (changed.includes(key)) {
        changed = changed.split(key).join(dictionary[key]);
      }
    }
    if (changed !== original) {
      node.textContent = changed;
    }
  }

  function translateElement(el, keys, dictionary) {
    if (shouldSkip(el)) return;

    // Translate text nodes
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(n => translateTextNode(n, keys, dictionary));

    // Translate placeholders
    el.querySelectorAll('[placeholder]').forEach(inp => {
      const ph = inp.getAttribute('placeholder');
      const translated = dictionary[ph.trim()];
      if (translated) inp.setAttribute('placeholder', translated);
    });

    // Translate title attributes
    el.querySelectorAll('[title]').forEach(el2 => {
      const t = el2.getAttribute('title');
      const translated = dictionary[t.trim()];
      if (translated) el2.setAttribute('title', translated);
    });

    // Translate select option text
    el.querySelectorAll('select option').forEach(opt => {
      const txt = opt.textContent.trim();
      if (dictionary[txt]) {
        opt.textContent = dictionary[txt];
      }
    });
  }

  function translatePage() {
    if (isEN()) {
      translateElement(document.body, sortedKeys, dict);
      document.documentElement.lang = 'en';
    } else {
      translateElement(document.body, sortedReverseKeys, reverseDict);
      document.documentElement.lang = 'it';
    }
  }

  // ── MutationObserver for dynamic content ────────────────────

  let observer = null;
  let pendingMutation = null;

  function startObserver() {
    if (observer) return;
    if (!isEN()) return; // Only observe when in EN mode

    observer = new MutationObserver((mutations) => {
      // Debounce: batch mutations
      if (pendingMutation) cancelAnimationFrame(pendingMutation);
      pendingMutation = requestAnimationFrame(() => {
        mutations.forEach(m => {
          m.addedNodes.forEach(node => {
            if (node.nodeType === 1 && !shouldSkip(node)) {
              translateElement(node, sortedKeys, dict);
            } else if (node.nodeType === 3) {
              translateTextNode(node, sortedKeys, dict);
            }
          });
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ── Toggle function ─────────────────────────────────────────

  function toggleLang() {
    const newLang = isEN() ? 'it' : 'en';
    setLang(newLang);

    // Stop observer first
    stopObserver();

    if (newLang === 'en') {
      translateElement(document.body, sortedKeys, dict);
      document.documentElement.lang = 'en';
      startObserver();
    } else {
      // Reload to get clean Italian version (reverse translation is lossy)
      window.location.reload();
      return;
    }

    // Update toggle button
    updateToggleBtn();
  }

  function updateToggleBtn() {
    const btn = document.getElementById('lang-toggle-btn');
    if (!btn) return;
    const en = isEN();
    btn.innerHTML = en ? '🇬🇧' : '🇮🇹';
    btn.title = en ? 'Switch to Italian' : 'Switch to English';
  }

  // ── Init ────────────────────────────────────────────────────

  function init() {
    // Apply translations on DOMContentLoaded if EN
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (isEN()) {
          translatePage();
          startObserver();
        }
        updateToggleBtn();
      });
    } else {
      if (isEN()) {
        translatePage();
        startObserver();
      }
      updateToggleBtn();
    }
  }

  // ── Public API ──────────────────────────────────────────────

  window.i18n = {
    t,
    getLang,
    setLang,
    isEN,
    toggleLang,
    translatePage,
    translateElement,
    updateToggleBtn,
    init,
    dict,
  };

  // Auto-init
  init();

})();
