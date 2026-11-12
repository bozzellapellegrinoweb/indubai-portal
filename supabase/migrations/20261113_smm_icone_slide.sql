-- ═══════════════════════════════════════════════════════════════════════
--  Le icone delle slide: c'era chi le sa disegnare, non chi le sceglie
-- ═══════════════════════════════════════════════════════════════════════
--
-- Il Cervello elenca da sempre le sei icone disponibili (D-FMT-04: tax,
-- building, globe, shield, chart, person) e il rendering le sa mettere.
-- Ma il brief del Copywriter, che e' l'unico posto in cui si spiega la
-- forma delle slide, non le nominava: quindi nessuno le ha mai scritte, e
-- il motore ripiegava su "chart" per ogni slide di ogni contenuto.
--
-- Si e' visto subito con i primi due reel, lanciati stasera: sei slide
-- scritte bene, zero icone, e sei volte lo stesso grafico a torta.
--
-- E' lo stesso difetto della colonna piattaforme, in piccolo: un campo che
-- qualcuno legge ma nessuno scrive e' un predefinito travestito da scelta.
--
-- Reversibile: 20261113_smm_icone_slide_down.sql rimette la riga com'era.

update smm_agents set
  system_prompt = replace(
    system_prompt,
    'Metti il badge nella prima slide, come "badge":"COMPLIANCE".',
    'Metti il badge nella prima slide, come "badge":"COMPLIANCE".
Su ogni slide metti anche "icon", scelta fra: tax, building, globe, shield, chart, person.
Scegline una che c''entri con quella slide: una cifra vuole chart, una societa'' building,
una sanzione shield, una persona person, una norma tax, un confronto fra paesi globe.
Se non la metti esce sempre la stessa su tutte, e sei slide uguali sembrano un errore.'),
  updated_at = now()
 where slug = 'copywriter'
   and system_prompt like '%Metti il badge nella prima slide%'
   and system_prompt not like '%Su ogni slide metti anche "icon"%';

-- Il Grafico imposta le slide quando gliele passano: deve saperlo anche lui.
update smm_agents set
  system_prompt = system_prompt || '

LE ICONE
Ogni slide porta "icon", scelta fra: tax, building, globe, shield, chart, person.
Se una slide arriva senza, mettila tu secondo quello che dice: senza, il
rendering usa sempre la stessa per tutte.',
  updated_at = now()
 where slug = 'grafico'
   and system_prompt not like '%LE ICONE%';
