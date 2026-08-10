// Edge Function: crea un cliente in pipeline da una cartella Google Drive.
// Autenticazione custom via segreto condiviso (app_config.drive_import_secret),
// inviato dallo script Apps Script nell'header x-import-secret.
// Anti-duplicato: clients.drive_folder_id (indice unico).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-import-secret',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const provided = req.headers.get('x-import-secret') || body.secret || '';
    const { data: cfg } = await sb.from('app_config').select('value').eq('key', 'drive_import_secret').single();
    if (!cfg || !provided || provided !== cfg.value) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: CORS });
    }

    let folders = Array.isArray(body.folders) ? body.folders : [];
    if (!folders.length && body.folder_id) folders = [{ id: body.folder_id, name: body.folder_name }];

    const created: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const f of folders) {
      const id = (f.id || '').toString().trim();
      const name = (f.name || '').toString().trim();
      if (!id || !name) { errors.push('folder senza id/nome'); continue; }

      const { data: exist } = await sb.from('clients').select('id').eq('drive_folder_id', id).limit(1);
      if (exist && exist.length) { skipped.push(name); continue; }

      const { error } = await sb.from('clients').insert({
        company_name: name,
        drive_folder_id: id,
        is_active: true,
        in_bilancio: true,
        pipeline_stage_id: null,
        notes: 'Creato automaticamente da cartella Google Drive',
      });
      if (error) {
        if ((error.message || '').includes('uq_clients_drive_folder_id')) skipped.push(name);
        else errors.push(name + ': ' + error.message);
      } else {
        created.push(name);
      }
    }

    return new Response(JSON.stringify({ ok: true, created, skipped, errors }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: CORS });
  }
});
