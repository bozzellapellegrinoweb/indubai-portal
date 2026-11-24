-- Blocco preavviso ferie: minimo 21 giorni prima della data di inizio.
-- Se la richiesta arriva tardi il trigger rifiuta l'INSERT con un messaggio
-- che specifica la data richiesta e quanti giorni mancano.

CREATE OR REPLACE FUNCTION check_leave_request_notice()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date_from - CURRENT_DATE < 21 THEN
    RAISE EXCEPTION 'Preavviso insufficiente: le ferie devono essere richieste almeno 21 giorni prima. La data di inizio % è tra % giorni.',
      NEW.date_from,
      (NEW.date_from - CURRENT_DATE);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_check_notice
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION check_leave_request_notice();
