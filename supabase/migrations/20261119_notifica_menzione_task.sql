-- Menzionare qualcuno in un commento manda un'email con event_type
-- 'task_mention', che non esisteva fra le impostazioni: non si sarebbe
-- potuta spegnere da /notifiche-admin come tutte le altre.
insert into notification_settings (event_type, label, category, audience, position)
values ('task_mention', 'Menzione in un commento di task', 'Task', 'user', 54)
on conflict (event_type) do nothing;
