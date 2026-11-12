-- Gli agenti possono leggere le notizie.
--
-- La dashboard del generatore parte dalle notizie da sempre: undici fonti
-- fra testate degli Emirati, l'autorita' fiscale, le free zone e i blog dei
-- concorrenti. Gli agenti della Regia non le vedevano, quindi potevano
-- scrivere solo dal Cervello: contenuti corretti e senza attualita'.
--
-- E le uscite "da notizia" del piano non potevano proprio esistere: il
-- Direttore ne apriva il contenuto, il Copywriter non aveva da dove
-- partire, e restavano ferme allo stato di idea. In produzione ce ne sono
-- tre cosi'.
--
-- Lo strumento lo prendono i tre che decidono di cosa si parla. Il Grafico
-- e il Revisore no: il primo monta quello che gli danno, il secondo
-- controlla, e nessuno dei due deve poter cambiare argomento.

-- In coda, e solo se non c'e' gia': cosi' si puo' riapplicare, e l'ordine
-- degli strumenti che l'agente aveva non si rimescola.
update smm_agents
   set strumenti = coalesce(strumenti, '{}') || array['cerca_notizie']
 where slug in ('direttore', 'stratega', 'copywriter')
   and not ('cerca_notizie' = any (coalesce(strumenti, '{}')));

-- E va detto nel prompt, non solo concesso: uno strumento che c'e' ma che
-- nessuno nomina non viene usato, come e' successo al rendering.
update smm_agents
   set system_prompt = system_prompt || E'\n\nLE NOTIZIE\n'
     || 'Hai cerca_notizie: legge le fonti del settore (testate degli Emirati, FTA, free zone, '
     || 'i blog dei concorrenti). Usalo quando il contenuto deve partire dall''attualita'', che e'' '
     || 'il motivo per cui qualcuno si ferma a leggere oggi invece che fra un mese. '
     || 'Se le fonti non danno niente su un argomento, dillo e scegline un altro: '
     || 'una notizia inventata e'' il danno peggiore che puoi fare al brand.'
 where slug in ('direttore', 'stratega', 'copywriter')
   and position(E'\n\nLE NOTIZIE\n' in system_prompt) = 0;

comment on table smm_agents is
  'Gli agenti della Regia. strumenti e'' l''elenco dei nomi che il runtime passa al modello: uno strumento non elencato qui non esiste per quell''agente.';
