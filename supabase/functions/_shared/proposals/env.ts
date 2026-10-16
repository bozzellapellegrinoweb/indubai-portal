// Configurazione del modulo Proposte. Tutto da variabili d'ambiente
// (secret delle Edge Function su Supabase): nessuna chiave nel codice.

export const env = (k: string, def = '') => Deno.env.get(k) ?? def;

export const SUPABASE_URL = env('SUPABASE_URL');
export const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

export const PORTAL_URL = env('PORTAL_URL', 'https://portal.indubai.it');
export const BUCKET = 'proposals';

// Durata del codice e della sessione (richiesta: 10 minuti, 5 tentativi, 30 minuti di inattivita').
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_MAX_PER_HOUR = 5;
export const SESSION_IDLE_MIN = 30;
export const SESSION_ABSOLUTE_HOURS = 12;

export const BRAND = {
  name: 'PB TAX International Tax Consultants FZCO',
  short: 'PB TAX',
  address: 'Platinum Tower, Unit 2503, JLT, Dubai, United Arab Emirates',
  logoUrl: env('PB_TAX_LOGO_URL'), // PNG facoltativo per la carta intestata del PDF finale
};

export const CONSENT_VERSION = '2026-10-17';
export const CONSENT_TEXT = {
  it: 'Dichiaro di aver letto la proposta e di accettarla. Acconsento a firmarla con firma elettronica semplice e alla registrazione di data, ora, indirizzo IP, dispositivo e numero di telefono verificato come prova della firma.',
  en: 'I confirm I have read the proposal and accept it. I agree to sign it with a simple electronic signature and to the recording of date, time, IP address, device and verified phone number as evidence of signature.',
};
