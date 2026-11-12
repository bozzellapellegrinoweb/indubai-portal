-- Annulla 20261113_smm_icone_slide.sql.

update smm_agents set
  system_prompt = replace(
    system_prompt,
    'Metti il badge nella prima slide, come "badge":"COMPLIANCE".
Su ogni slide metti anche "icon", scelta fra: tax, building, globe, shield, chart, person.
Scegline una che c''entri con quella slide: una cifra vuole chart, una societa'' building,
una sanzione shield, una persona person, una norma tax, un confronto fra paesi globe.
Se non la metti esce sempre la stessa su tutte, e sei slide uguali sembrano un errore.',
    'Metti il badge nella prima slide, come "badge":"COMPLIANCE".'),
  updated_at = now()
 where slug = 'copywriter';

update smm_agents set
  system_prompt = replace(system_prompt, '

LE ICONE
Ogni slide porta "icon", scelta fra: tax, building, globe, shield, chart, person.
Se una slide arriva senza, mettila tu secondo quello che dice: senza, il
rendering usa sempre la stessa per tutte.', ''),
  updated_at = now()
 where slug = 'grafico';
