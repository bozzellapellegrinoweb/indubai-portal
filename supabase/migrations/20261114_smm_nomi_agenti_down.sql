-- Annulla 20261114_smm_nomi_agenti.sql: rimette le etichette al posto dei nomi.

update smm_agents set nome = v.nome, updated_at = now()
  from (values
    ('direttore',    'Direttore'),
    ('stratega',     'Stratega editoriale'),
    ('copywriter',   'Copywriter'),
    ('grafico',      'Grafico'),
    ('video',        'Video'),
    ('revisore',     'Revisore di conformita'),
    ('pubblicatore', 'Pubblicatore'),
    ('analista',     'Analista')
  ) as v(slug, nome)
 where smm_agents.slug = v.slug;
