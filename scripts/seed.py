#!/usr/bin/env python3
"""
InDubai Portal — Seed Script
Legge il file Excel Segreteria abbonati e genera SQL per Supabase.
Usa: python3 seed.py --excel <path> --out seed_data.sql
"""

import pandas as pd
import json
import re
import sys
import argparse
from datetime import datetime, date
from pathlib import Path


# ──────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────

def sql_str(v):
    """Escape e wrappa in apici singoli. None → NULL."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    s = str(v).replace("'", "''").strip()
    if s == '' or s.lower() in ('nan', 'nat', 'none'):
        return 'NULL'
    return f"'{s}'"

def sql_bool(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    s = str(v).lower().strip()
    if s in ('true', '1', 'yes', 'si', 'sì'):
        return 'true'
    if s in ('false', '0', 'no'):
        return 'false'
    return 'NULL'

def sql_date(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    if isinstance(v, (datetime, date, pd.Timestamp)):
        try:
            return f"'{pd.Timestamp(v).strftime('%Y-%m-%d')}'"
        except:
            return 'NULL'
    s = str(v).strip()
    if s in ('', 'nan', 'NaT', '-', 'None'):
        return 'NULL'
    # Prova vari formati
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return f"'{datetime.strptime(s, fmt).strftime('%Y-%m-%d')}'"
        except:
            pass
    return 'NULL'

def sql_num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    try:
        return str(float(v))
    except:
        return 'NULL'

def sql_int(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    try:
        return str(int(float(v)))
    except:
        return 'NULL'

def sql_array(lst):
    """Python list → PostgreSQL text array."""
    if not lst:
        return 'NULL'
    escaped = [f"'{x}'" for x in lst if x]
    return f"ARRAY[{', '.join(escaped)}]::text[]"

def parse_partner(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 'NULL'
    s = str(v).lower().strip()
    if 'noi' in s:
        return "'noi'"
    if 'vat' in s:
        return "'vat_consultant'"
    if 'affinitas' in s:
        return "'affinitas'"
    if 'sospeso' in s or 'sospend' in s:
        return "'in_sospeso'"
    if s in ('', 'nan', '-'):
        return 'NULL'
    return "'altro'"

def parse_subscription_status(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "'pending'"
    s = str(v).strip().lower()
    if s == 'ok':
        return "'ok'"
    if 'failed' in s or 'fail' in s:
        return "'failed'"
    if 'tentativo' in s or 'no tent' in s:
        return "'no_tentativo'"
    if 'manuale' in s or 'fattura' in s:
        return "'manual'"
    if 'annuale' in s or 'annual' in s:
        return "'annual'"
    return "'pending'"

def extract_bank_accounts(notes):
    """Estrae i conti bancari dalle note libere."""
    if not notes or pd.isna(notes):
        return []
    s = str(notes).lower()
    accounts = []
    mapping = {
        'wio': 'wio',
        'stripe': 'stripe',
        'paypal': 'paypal',
        'mashreq': 'mashreq',
        'payoneer': 'payoneer',
        'hubpay': 'hubpay',
        'credium': 'credium',
        'currenxie': 'currenxie',
        'ziina': 'ziina',
        'mamo': 'mamo',
        'gateway': 'gateway',
        'whoop': 'whoop',
    }
    for key, val in mapping.items():
        if key in s:
            accounts.append(val)
    return list(set(accounts))

def clean_company_name(name):
    """Pulisce il nome azienda rimuovendo nomi persona dopo il trattino."""
    if not name or pd.isna(name):
        return None
    return str(name).strip()

def extract_contact_name(company_str):
    """Estrae il nome del contatto dalla stringa 'AZIENDA - Nome Cognome'."""
    if not company_str or pd.isna(company_str):
        return None
    parts = str(company_str).split(' - ', 1)
    if len(parts) > 1:
        return parts[1].strip()
    return None

def gen_client_id(company_name):
    """Genera un ID deterministico dal nome (per join cross-tabelle)."""
    import hashlib
    h = hashlib.md5(company_name.encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


# ──────────────────────────────────────────────────────────────
# PARSING SHEETS
# ──────────────────────────────────────────────────────────────

def parse_estratti(df):
    """Estrae i dati dalla tab 'Estratti'."""
    # Row 0 = header
    data_rows = df.iloc[1:].copy()
    data_rows.columns = [
        'company', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
        'lug', 'ago', 'set', 'ott', 'nov', 'dic',
        'notes', 'partner', 'corporate_tax', 'licenza', 'scadenza_ct', 'indubai'
    ]

    clients = {}
    for _, row in data_rows.iterrows():
        company = str(row['company']).strip() if pd.notna(row['company']) else None
        if not company or company.lower() in ('nan', 'cliente', ''):
            continue

        cid = gen_client_id(company)
        contact = extract_contact_name(company)

        # Mesi con estratto mandato (gennaio-dicembre 2026)
        months_received = {}
        for i, col in enumerate(['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
                                  'lug', 'ago', 'set', 'ott', 'nov', 'dic'], 1):
            v = row[col]
            if pd.notna(v) and str(v).lower() == 'true':
                months_received[i] = True
            elif pd.notna(v) and str(v).lower() == 'false':
                months_received[i] = False

        bank_accs = extract_bank_accounts(row['notes'])

        clients[cid] = {
            'id': cid,
            'company_name': company,
            'contact_name': contact,
            'accounting_partner': parse_partner(row['partner']),
            'bank_accounts': bank_accs,
            'bank_notes': str(row['notes']).strip() if pd.notna(row['notes']) else None,
            'corporate_tax_registered': True if str(row.get('corporate_tax', '')).strip().lower() == 'si' else False,
            'trade_license_date': sql_date(row.get('licenza')),
            'corporate_tax_expiry': sql_date(row.get('scadenza_ct')),
            'months_received': months_received,
        }
    return clients

def parse_subscription(df, clients_by_name):
    """Estrae i pagamenti mensili dalla tab 'Subscription'."""
    data_rows = df.iloc[1:].copy()
    data_rows.columns = [
        'company', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
        'lug', 'ago', 'set', 'ott', 'nov', 'dic', 'notes', 'day'
    ]

    subscriptions = []
    day_updates = {}

    for _, row in data_rows.iterrows():
        company = str(row['company']).strip() if pd.notna(row['company']) else None
        if not company or company.lower() in ('nan', 'cliente', ''):
            continue

        cid = find_client_id(company, clients_by_name)
        if not cid:
            cid = gen_client_id(company)

        day = sql_int(row.get('day'))
        if day != 'NULL':
            day_updates[cid] = day

        for i, col in enumerate(['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
                                  'lug', 'ago', 'set', 'ott', 'nov', 'dic'], 1):
            v = row[col]
            if pd.notna(v):
                subscriptions.append({
                    'client_id': cid,
                    'year': 2026,
                    'month': i,
                    'status': parse_subscription_status(v),
                    'notes': sql_str(row.get('notes')) if i == 1 else 'NULL',
                })

    return subscriptions, day_updates

def parse_vat(df, clients_by_name):
    """Estrae VAT register dalla tab 'VAT register new'."""
    # Header in riga 2-3
    data_rows = df.iloc[4:].copy()
    data_rows.columns = [
        'company', 'partner', 'application', 'approval',
        'deadline_1', 'deadline_2', 'deadline_3', 'deadline_4',
        'payment_studio', 'payment_vat'
    ]

    records = []
    for _, row in data_rows.iterrows():
        company = str(row['company']).strip() if pd.notna(row['company']) else None
        if not company or company.lower() in ('nan', ''):
            continue

        cid = find_client_id(company, clients_by_name)
        if not cid:
            cid = gen_client_id(company)

        records.append({
            'client_id': cid,
            'accounting_partner': parse_partner(row['partner']),
            'application_date': sql_date(row['application']),
            'approval_date': sql_date(row['approval']),
            'return_deadline_1': sql_date(row['deadline_1']),
            'return_deadline_2': sql_date(row['deadline_2']),
            'return_deadline_3': sql_date(row['deadline_3']),
            'return_deadline_4': sql_date(row['deadline_4']),
            'payment_to_studio': sql_str(row['payment_studio']),
            'payment_vat': sql_str(row['payment_vat']),
        })
    return records

def parse_pagamenti(df, clients_by_name):
    """Estrae dati dalla tab 'Pagamenti'."""
    updates = []
    for _, row in df.iterrows():
        name = str(row['CLIENTE']).strip() if pd.notna(row['CLIENTE']) else None
        if not name or name.lower() in ('nan', ''):
            continue
        cid = find_client_id(name, clients_by_name)
        if not cid:
            cid = gen_client_id(name)
        updates.append({
            'client_id': cid,
            'start_date': sql_date(row.get('DATA AVVIO')),
            'service_cost': sql_num(row.get('COSTO SERVIZIO')),
            'notes': sql_str(row.get('NOTE PAGAMENTI')),
        })
    return updates

def find_client_id(name, clients_by_name):
    """Trova il client_id cercando il nome (fuzzy match semplice)."""
    name_clean = name.lower().strip()
    # Match esatto
    if name_clean in clients_by_name:
        return clients_by_name[name_clean]
    # Match parziale: cerca se il nome è contenuto in una chiave o viceversa
    for key, cid in clients_by_name.items():
        # Prendi solo la parte prima del trattino per confronto
        key_base = key.split(' - ')[0].strip()
        name_base = name_clean.split(' - ')[0].strip()
        if key_base == name_base or name_base in key_base or key_base in name_base:
            return cid
    return None


# ──────────────────────────────────────────────────────────────
# GENERAZIONE SQL
# ──────────────────────────────────────────────────────────────

def generate_sql(excel_path):
    xl = pd.read_excel(excel_path, sheet_name=None)

    lines = []
    lines.append("-- ============================================================")
    lines.append("-- InDubai Portal — Seed Data")
    lines.append(f"-- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("begin;")
    lines.append("")

    # ── 1. CLIENTS da sheet Estratti (fonte più completa) ──
    estratti = xl.get('Estratti ')
    if estratti is None:
        estratti = xl.get('Estratti')
    clients_data = parse_estratti(estratti)

    # Costruisci lookup per nome
    clients_by_name = {}
    for cid, c in clients_data.items():
        clients_by_name[c['company_name'].lower()] = cid

    # Integra con sheet Pagamenti
    pagamenti_df = xl.get('Pagamenti')
    pagamenti = parse_pagamenti(pagamenti_df, clients_by_name)

    # Mappa pagamenti per client_id
    pag_map = {p['client_id']: p for p in pagamenti}

    # Integra subscription day
    sub_df = xl.get('Subscription ')
    if sub_df is None:
        sub_df = xl.get('Subscription')
    _, day_updates = parse_subscription(sub_df, clients_by_name)

    # ── INSERT clients ──
    lines.append("-- ── CLIENTS ─────────────────────────────────────────────────")
    lines.append("insert into clients (")
    lines.append("  id, company_name, contact_name, accounting_partner,")
    lines.append("  bank_accounts, bank_notes, corporate_tax_registered,")
    lines.append("  trade_license_date, corporate_tax_expiry,")
    lines.append("  service_cost, start_date, subscription_day,")
    lines.append("  is_active, in_bilancio, notes")
    lines.append(") values")

    client_rows = []
    for cid, c in clients_data.items():
        pag = pag_map.get(cid, {})
        bank_arr = sql_array(c['bank_accounts'])
        subscription_day = day_updates.get(cid, 'NULL')

        row = (
            f"  ({sql_str(cid)}, {sql_str(c['company_name'])}, {sql_str(c['contact_name'])}, "
            f"{c['accounting_partner']},\n"
            f"   {bank_arr}, {sql_str(c['bank_notes'])}, "
            f"{'true' if c['corporate_tax_registered'] else 'false'},\n"
            f"   {c['trade_license_date']}, {c['corporate_tax_expiry']},\n"
            f"   {pag.get('service_cost', 'NULL')}, {pag.get('start_date', 'NULL')}, "
            f"{subscription_day},\n"
            f"   true, true, {pag.get('notes', 'NULL')})"
        )
        client_rows.append(row)

    lines.append(',\n'.join(client_rows) + ';')
    lines.append("")

    # ── INSERT bank_statements (estratti 2026) ──
    lines.append("-- ── BANK STATEMENTS 2026 ──────────────────────────────────────")
    lines.append("insert into bank_statements (client_id, year, month, received)")
    lines.append("values")
    bs_rows = []
    for cid, c in clients_data.items():
        for month, received in c['months_received'].items():
            bs_rows.append(f"  ({sql_str(cid)}, 2026, {month}, {'true' if received else 'false'})")
    if bs_rows:
        lines.append(',\n'.join(bs_rows) + ';')
    lines.append("")

    # ── INSERT subscription_payments ──
    subscriptions, _ = parse_subscription(sub_df, clients_by_name)
    if subscriptions:
        lines.append("-- ── SUBSCRIPTION PAYMENTS 2026 ─────────────────────────────")
        lines.append("insert into subscription_payments (client_id, year, month, status, notes)")
        lines.append("values")
        sp_rows = []
        for sp in subscriptions:
            sp_rows.append(
                f"  ({sql_str(sp['client_id'])}, {sp['year']}, {sp['month']}, "
                f"{sp['status']}, {sp['notes']})"
            )
        lines.append(',\n'.join(sp_rows) + ';')
        lines.append("")

    # ── INSERT vat_register ──
    vat_df = xl.get('VAT register new')
    if vat_df is None:
        vat_df = xl.get('VAT register new ')
    vat_records = parse_vat(vat_df, clients_by_name)
    if vat_records:
        lines.append("-- ── VAT REGISTER ───────────────────────────────────────────")
        lines.append("insert into vat_register (")
        lines.append("  client_id, accounting_partner, application_date, approval_date,")
        lines.append("  return_deadline_1, return_deadline_2, return_deadline_3, return_deadline_4,")
        lines.append("  payment_to_studio, payment_vat")
        lines.append(") values")
        vr_rows = []
        for vr in vat_records:
            vr_rows.append(
                f"  ({sql_str(vr['client_id'])}, {vr['accounting_partner']}, "
                f"{vr['application_date']}, {vr['approval_date']},\n"
                f"   {vr['return_deadline_1']}, {vr['return_deadline_2']}, "
                f"{vr['return_deadline_3']}, {vr['return_deadline_4']},\n"
                f"   {vr['payment_to_studio']}, {vr['payment_vat']})"
            )
        lines.append(',\n'.join(vr_rows) + ';')
        lines.append("")

    # ── INSERT affinitas_subscriptions ──
    aff_df = xl.get('Abbonati affinitas')
    if aff_df is not None:
        lines.append("-- ── AFFINITAS SUBSCRIPTIONS ─────────────────────────────────")
        lines.append("insert into affinitas_subscriptions (")
        lines.append("  subscription_ref, company_name, status, start_date,")
        lines.append("  next_payment, orders_count, notes, in_segreteria")
        lines.append(") values")
        aff_rows = []
        for _, row in aff_df.iterrows():
            sub_ref_raw = str(row.get('SubscriptionSort ascending.', '')).strip()
            # Estrai ref numero e nome azienda
            ref_match = re.match(r'(#\d+)\s+for\s+(.*)', sub_ref_raw)
            ref = ref_match.group(1) if ref_match else sub_ref_raw
            comp = ref_match.group(2) if ref_match else ''

            note_raw = str(row.get('Note', '')).strip()
            in_seg = 'false' if 'no in gestione' in note_raw.lower() else 'true'

            # Parsa next payment (può essere "In 3 days", una data, ecc.)
            next_pay_raw = str(row.get('Next PaymentSort ascending.', '')).strip()
            next_pay = 'NULL'
            try:
                next_pay = sql_date(pd.to_datetime(next_pay_raw))
            except:
                pass

            start_raw = str(row.get('Start DateSort ascending.', '')).strip()
            start_d = 'NULL'
            try:
                start_d = sql_date(pd.to_datetime(start_raw))
            except:
                pass

            aff_rows.append(
                f"  ({sql_str(ref)}, {sql_str(comp)}, "
                f"'Active', {start_d},\n"
                f"   {next_pay}, {sql_int(row.get('Orders'))}, "
                f"{sql_str(note_raw) if note_raw and note_raw != 'nan' else 'NULL'}, {in_seg})"
            )
        if aff_rows:
            lines.append(',\n'.join(aff_rows) + ';')
        lines.append("")

    lines.append("commit;")
    lines.append("")
    lines.append("-- ============================================================")
    lines.append("-- Seed completato. Clienti caricati: " + str(len(clients_data)))
    lines.append("-- ============================================================")

    return '\n'.join(lines)


# ──────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='InDubai Portal Seed Generator')
    parser.add_argument('--excel', required=True, help='Path al file Excel')
    parser.add_argument('--out', default='seed_data.sql', help='Output SQL file')
    args = parser.parse_args()

    print(f"📂 Lettura Excel: {args.excel}")
    sql = generate_sql(args.excel)

    out_path = Path(args.out)
    out_path.write_text(sql)
    print(f"✅ SQL generato: {out_path} ({out_path.stat().st_size // 1024} KB)")
    print("📋 Ora puoi eseguire il file nel SQL editor di Supabase.")
