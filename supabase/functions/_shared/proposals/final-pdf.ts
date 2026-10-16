// PDF finale: proposta originale + pagina firme + pagina di certificazione,
// su carta intestata PB TAX.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';
import { BRAND } from './env.ts';
import { describeUA, dubaiTime, formatAmount, utcIso } from './util.ts';

export interface SignatureInfo {
  kind: 'client' | 'countersign';
  signer_name: string;
  role_label: string;          // es. "Cliente" / "PB TAX"
  method: 'typed' | 'drawn';
  typed_text: string | null;
  image_png: Uint8Array | null;
  signed_at: string;
  signed_at_dubai: string;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  verified_phone: string | null;
  verification_channel: string | null;
  signature_sha256: string | null;
}

export interface FinalPdfInput {
  originalPdf: Uint8Array;
  proposal: {
    id: string; title: string; amount: number | null; currency: string; locale: string;
    original_pdf_sha256: string; pages_sha256: string | null; page_count: number;
    sent_at: string | null; first_opened_at: string | null;
  };
  clientName: string;
  consentText: string;
  consentVersion: string;
  signatures: SignatureInfo[];   // client poi countersign
  events: { created_at: string; event_type: string; details: Record<string, unknown> }[];
  eventsChainHead: string | null;
  logoPng?: Uint8Array | null;
}

const GREEN = rgb(0x47 / 255, 0xee / 255, 0x74 / 255);
const INK = rgb(0, 0, 0);
const MUTED = rgb(0.36, 0.35, 0.33);
const LINE = rgb(0.89, 0.87, 0.84);

// Helvetica standard copre WinAnsi: tutto il resto diventa "?" invece di
// far fallire la generazione del documento.
function safe(font: PDFFont, s: unknown): string {
  const str = String(s ?? '').replace(/ | /g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let out = '';
  for (const ch of str) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const words = safe(font, text).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= width) { cur = t; continue; }
    if (cur) lines.push(cur);
    // parola piu' lunga della riga (es. hash): spezzala
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let i = rest.length;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
      lines.push(rest.slice(0, i)); rest = rest.slice(i);
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Pen { page: PDFPage; y: number; regular: PDFFont; bold: PDFFont; oblique: PDFFont; }

const M = 50; // margine

async function letterhead(doc: PDFDocument, fonts: Omit<Pen, 'page' | 'y'>, title: string, logo?: Uint8Array | null): Promise<Pen> {
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  let y = height - M;
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const h = 34, w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h + 6, width: w, height: h });
      y -= h + 4;
    } catch { /* logo non valido: resta l'intestazione testuale */ }
  }
  page.drawText(BRAND.short, { x: M, y: y - 14, size: 18, font: fonts.bold, color: INK });
  page.drawText(safe(fonts.regular, BRAND.name.toUpperCase()), { x: M, y: y - 28, size: 7.5, font: fonts.bold, color: MUTED });
  page.drawText(safe(fonts.regular, BRAND.address), { x: M, y: y - 39, size: 7.5, font: fonts.regular, color: MUTED });
  y -= 50;
  page.drawRectangle({ x: M, y, width: width - 2 * M, height: 3, color: GREEN });
  y -= 30;
  page.drawText(safe(fonts.bold, title), { x: M, y, size: 15, font: fonts.bold, color: INK });
  y -= 22;
  return { page, y, ...fonts };
}

function row(p: Pen, label: string, value: string, opts: { size?: number; labelW?: number } = {}) {
  const size = opts.size ?? 8.5, labelW = opts.labelW ?? 150;
  const width = p.page.getSize().width - 2 * M - labelW;
  const lines = wrap(p.regular, size, value || '—', width);
  p.page.drawText(safe(p.bold, label), { x: M, y: p.y, size, font: p.bold, color: MUTED });
  for (const l of lines) {
    p.page.drawText(l, { x: M + labelW, y: p.y, size, font: p.regular, color: INK });
    p.y -= size + 4;
  }
  p.y -= 2;
}

function para(p: Pen, text: string, size = 8.5, color = INK) {
  const width = p.page.getSize().width - 2 * M;
  for (const l of wrap(p.regular, size, text, width)) {
    p.page.drawText(l, { x: M, y: p.y, size, font: p.regular, color });
    p.y -= size + 4;
  }
  p.y -= 4;
}

function heading(p: Pen, text: string) {
  p.y -= 6;
  p.page.drawText(safe(p.bold, text), { x: M, y: p.y, size: 10.5, font: p.bold, color: INK });
  p.y -= 6;
  p.page.drawLine({ start: { x: M, y: p.y }, end: { x: p.page.getSize().width - M, y: p.y }, thickness: 0.6, color: LINE });
  p.y -= 14;
}

export async function buildFinalPdf(input: FinalPdfInput): Promise<Uint8Array> {
  const it = input.proposal.locale !== 'en';
  const L = (a: string, b: string) => (it ? a : b);

  const src = await PDFDocument.load(input.originalPdf, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.proposal.title} — ${L('firmata', 'signed')}`);
  doc.setAuthor(BRAND.name);
  doc.setProducer('InDubai Portal — Proposte');
  doc.setCreationDate(new Date());

  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((pg) => doc.addPage(pg));

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    oblique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  // ── Pagina firme ───────────────────────────────────────────
  const p = await letterhead(doc, fonts, L('Firme', 'Signatures'), input.logoPng);
  row(p, L('Documento', 'Document'), input.proposal.title);
  row(p, L('Cliente', 'Client'), input.clientName);
  row(p, L('Importo', 'Amount'), formatAmount(input.proposal.amount, input.proposal.currency, input.proposal.locale));
  row(p, L('ID proposta', 'Proposal ID'), input.proposal.id);
  p.y -= 10;

  const boxW = (p.page.getSize().width - 2 * M - 20) / 2;
  const boxH = 190;
  const top = p.y;
  for (let i = 0; i < input.signatures.length && i < 2; i++) {
    const s = input.signatures[i];
    const x = M + i * (boxW + 20);
    p.page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 1 });
    p.page.drawText(safe(fonts.bold, s.role_label.toUpperCase()), { x: x + 12, y: top - 20, size: 8, font: fonts.bold, color: MUTED });
    // area firma
    const areaY = top - 120;
    if (s.method === 'drawn' && s.image_png) {
      const img = await doc.embedPng(s.image_png);
      const maxW = boxW - 24, maxH = 80;
      const k = Math.min(maxW / img.width, maxH / img.height);
      p.page.drawImage(img, { x: x + 12, y: areaY, width: img.width * k, height: img.height * k });
    } else {
      const t = safe(fonts.oblique, s.typed_text || s.signer_name);
      let size = 26;
      while (size > 10 && fonts.oblique.widthOfTextAtSize(t, size) > boxW - 24) size--;
      p.page.drawText(t, { x: x + 12, y: areaY + 30, size, font: fonts.oblique, color: rgb(0.05, 0.1, 0.35) });
    }
    p.page.drawLine({ start: { x: x + 12, y: areaY - 6 }, end: { x: x + boxW - 12, y: areaY - 6 }, thickness: 0.6, color: MUTED });
    let ty = areaY - 20;
    const small = (t: string, f = fonts.regular) => {
      for (const l of wrap(f, 7.5, t, boxW - 24)) {
        p.page.drawText(l, { x: x + 12, y: ty, size: 7.5, font: f, color: INK }); ty -= 10;
      }
    };
    small(s.signer_name, fonts.bold);
    small(`${L('Firmato il', 'Signed on')} ${s.signed_at_dubai}`);
    small(`UTC ${utcIso(s.signed_at)}`);
    if (s.verified_phone) small(`${L('Numero verificato', 'Verified number')}: ${s.verified_phone}`);
  }
  p.y = top - boxH - 20;
  para(p, L(
    'Firma elettronica semplice. I dati di verifica di ciascuna firma sono riportati nella pagina di certificazione che segue.',
    'Simple electronic signature. The verification data for each signature is set out on the following certification page.'), 8, MUTED);

  // ── Pagina di certificazione ──────────────────────────────
  const c = await letterhead(doc, fonts, L('Certificato di completamento', 'Certificate of completion'), input.logoPng);
  heading(c, L('Documento', 'Document'));
  row(c, L('Titolo', 'Title'), input.proposal.title);
  row(c, L('Cliente', 'Client'), input.clientName);
  row(c, L('Importo', 'Amount'), formatAmount(input.proposal.amount, input.proposal.currency, input.proposal.locale));
  row(c, L('ID proposta', 'Proposal ID'), input.proposal.id);
  row(c, L('Pagine della proposta', 'Proposal pages'), String(input.proposal.page_count));
  row(c, 'SHA-256 PDF originale', input.proposal.original_pdf_sha256);
  if (input.proposal.pages_sha256) row(c, L('SHA-256 pagine mostrate', 'SHA-256 displayed pages'), input.proposal.pages_sha256);
  if (input.proposal.sent_at) row(c, L('Inviata', 'Sent'), `${dubaiTime(input.proposal.sent_at)} · UTC ${utcIso(input.proposal.sent_at)}`);
  if (input.proposal.first_opened_at) row(c, L('Prima apertura', 'First opened'), `${dubaiTime(input.proposal.first_opened_at)} · UTC ${utcIso(input.proposal.first_opened_at)}`);

  for (const s of input.signatures) {
    heading(c, s.kind === 'client' ? L('Firma del cliente', 'Client signature') : L('Controfirma', 'Countersignature'));
    row(c, L('Firmatario', 'Signer'), `${s.signer_name} (${s.role_label})`);
    row(c, L('Data e ora UTC', 'Date and time UTC'), utcIso(s.signed_at));
    row(c, L('Data e ora Dubai', 'Date and time Dubai'), s.signed_at_dubai);
    row(c, L('Metodo', 'Method'), s.method === 'drawn' ? L('Firma disegnata', 'Drawn signature') : L('Firma scritta', 'Typed signature') + (s.typed_text ? `: "${s.typed_text}"` : ''));
    if (s.verified_phone) row(c, L('Numero verificato', 'Verified number'), `${s.verified_phone}${s.verification_channel ? ` (${L('codice via', 'code via')} ${s.verification_channel})` : ''}`);
    row(c, L('Indirizzo IP', 'IP address'), [s.ip || '—', s.country].filter(Boolean).join(' · '));
    row(c, L('Dispositivo', 'Device'), `${describeUA(s.user_agent)} — ${s.user_agent || ''}`);
    if (s.signature_sha256) row(c, L('SHA-256 immagine firma', 'SHA-256 signature image'), s.signature_sha256);
    row(c, L('Impronta del documento firmato', 'Fingerprint of signed document'), input.proposal.original_pdf_sha256);
    if (s.kind === 'client') row(c, L('Consenso', 'Consent'), `${input.consentText} (v. ${input.consentVersion})`);
  }

  let cc: Pen = c;
  if (c.y < 260) cc = await letterhead(doc, fonts, L('Certificato di completamento (segue)', 'Certificate of completion (continued)'), input.logoPng);
  const cTail = cc;
  heading(cTail, L('Registro eventi', 'Event log'));
  for (const e of input.events.slice(-40)) {
    if (cTail.y < M + 60) break;
    row(cTail, dubaiTime(e.created_at, false), e.event_type.replace(/_/g, ' '), { size: 7.5, labelW: 150 });
  }
  if (input.eventsChainHead) row(cTail, L('Ultimo hash del registro', 'Last log hash'), input.eventsChainHead, { size: 7.5 });
  cTail.y = Math.max(cTail.y, M + 30);
  para(cTail, L(
    `Documento generato dal portale ${BRAND.short} il ${dubaiTime(new Date())}. L'impronta SHA-256 di questo PDF finale e' registrata nel portale: qualsiasi modifica successiva la renderebbe diversa.`,
    `Document generated by the ${BRAND.short} portal on ${dubaiTime(new Date())}. The SHA-256 fingerprint of this final PDF is recorded in the portal: any later change would alter it.`), 7.5, MUTED);

  return await doc.save();
}
