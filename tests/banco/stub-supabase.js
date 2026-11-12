window.sb = {
  requireAuth: () => ({ user: { id: 'u-prova', email: 'prova@indubai.it' } }),
  getCurrentUser: () => ({ id: 'u-prova', email: 'prova@indubai.it' }),
  getCurrentProfile: () => ({ id: 'u-prova', role: 'admin', full_name: 'Prova' }),
  getSession: () => ({ access_token: 'finto' }),
};
