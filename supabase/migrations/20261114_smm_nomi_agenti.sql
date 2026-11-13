-- ═══════════════════════════════════════════════════════════════════════
--  Gli agenti hanno un nome, non solo un mestiere
-- ═══════════════════════════════════════════════════════════════════════
--
-- Si chiamavano "Direttore", "Copywriter", "Revisore di conformita":
-- etichette, non persone. In una stanza dove si vedono camminare, prendere
-- il caffe' e parlarsi, chiamarli col mestiere e' come avere otto colleghi
-- che rispondono a "Contabilita'". Pellegrino ha chiesto nomi da Dragon
-- Ball, e quale a chi non e' casuale:
--
--   Vegeta   Direttore     comanda, decide il piano, assegna
--   Bulma    Stratega      la testa che inventa e tiene insieme le cose
--   Gohan    Copywriter    studioso, e' quello che scrive
--   Trunks   Grafico       monta, costruisce, mette insieme i pezzi
--   Goku     Video         il movimento e l'azione
--   Piccolo  Revisore      severo, controlla, non fa passare niente
--   Crilin   Pubblicatore  affidabile, porta a termine
--   Whis     Analista      osserva e misura tutto, da fuori
--
-- Il mestiere resta in `ruolo` e non si tocca: il nome dice chi e', il
-- ruolo dice cosa fa. Devono comparire insieme ovunque prima bastasse il
-- nome — cartellino nella stanza, fumetto, fascia laterale, "Tocca a te" —
-- se no chi passa davanti allo schermo appeso in ufficio legge "Piccolo ha
-- una domanda" e non sa di cosa si parla.
--
-- Reversibile: 20261114_smm_nomi_agenti_down.sql rimette le etichette.

update smm_agents set nome = v.nome, updated_at = now()
  from (values
    ('direttore',    'Vegeta'),
    ('stratega',     'Bulma'),
    ('copywriter',   'Gohan'),
    ('grafico',      'Trunks'),
    ('video',        'Goku'),
    ('revisore',     'Piccolo'),
    ('pubblicatore', 'Crilin'),
    ('analista',     'Whis')
  ) as v(slug, nome)
 where smm_agents.slug = v.slug;
