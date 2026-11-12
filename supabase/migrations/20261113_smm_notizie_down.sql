-- Torna indietro: lo strumento e la riga di prompt spariscono.
update smm_agents
   set strumenti = array_remove(strumenti, 'cerca_notizie')
 where slug in ('direttore', 'stratega', 'copywriter');

update smm_agents
   set system_prompt = left(system_prompt, position(E'\n\nLE NOTIZIE\n' in system_prompt) - 1)
 where slug in ('direttore', 'stratega', 'copywriter')
   and position(E'\n\nLE NOTIZIE\n' in system_prompt) > 0;
