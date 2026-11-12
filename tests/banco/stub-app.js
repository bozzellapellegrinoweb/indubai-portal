window.canSeePage = () => true;
window.ui = {
  showToast: (t, k) => { (window.__toast ||= []).push([k, t]); console.log('[toast]', k, t); },
  formatDate: (d) => new Date(d).toLocaleDateString('it-IT'),
  escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
};
