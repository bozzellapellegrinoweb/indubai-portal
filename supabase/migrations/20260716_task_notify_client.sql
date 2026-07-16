-- Fix: al completamento di una task con client_id, il cliente riceveva sempre
-- l'email di notifica, anche per task puramente interne (es. task create e
-- assegnate a se stessi solo per tracciare un lavoro su un cliente).
-- Aggiunge un flag esplicito, di default disattivato: la notifica al cliente
-- parte solo se lo staff la abilita esplicitamente in fase di creazione task.

alter table tasks add column if not exists notify_client boolean not null default false;
