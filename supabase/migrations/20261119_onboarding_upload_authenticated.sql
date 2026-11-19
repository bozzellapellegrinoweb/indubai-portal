-- ============================================================
-- Allegati dell'onboarding: anche per chi ha gia' un accesso
-- ============================================================
-- La policy di caricamento valeva solo per il ruolo 'anon'. Ma un cliente che
-- ha gia' un accesso al portale, e apre il link di onboarding mentre e'
-- dentro, manda le richieste come 'authenticated': per lui nessuna policy
-- copriva il percorso onboarding/<token>/, e gli allegati fallivano senza
-- spiegazione.
--
-- Invece di sostituire la policy esistente (ALTER POLICY non puo' cambiare i
-- ruoli: servirebbe DROP + CREATE) se ne aggiunge una gemella per
-- 'authenticated'. Le policy permissive si sommano in OR, quindi l'effetto e'
-- identico senza toccare quella che gia' funziona.
--
-- Il controllo non cambia di una virgola: percorso sotto onboarding/ e token
-- di una raccolta ancora in bozza. Non allarga niente a nessuno.
-- ============================================================

create policy "onboarding_pubblico_upload_authenticated" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = 'onboarding'
    and will_onboarding_bozza_aperta((storage.foldername(name))[2])
  );
