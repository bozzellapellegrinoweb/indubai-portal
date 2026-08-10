/**
 * InDubai — Auto import cartelle Google Drive → Pipeline clienti.
 *
 * Ogni nuova sottocartella creata nella cartella "Clienti" diventa un cliente
 * nella pipeline del portale (colonna "Non assegnati").
 *
 * SETUP (una tantum):
 *  1. Vai su https://script.google.com con l'account che ha accesso alla cartella
 *     (owner: info@pellegrinobozzella.com).
 *  2. Nuovo progetto → incolla questo file.
 *  3. Sostituisci IMPORT_SECRET con il segreto fornito.
 *  4. Esegui una volta la funzione installTrigger (autorizza i permessi Drive).
 *     Da quel momento controlla ogni 15 minuti e importa SOLO le cartelle nuove.
 */

const FOLDER_ID     = '1KkNrvX0740ecl_rIMm92stK2SdPTtApK';
const FUNCTION_URL  = 'https://gvdoqcgkzbziqufahhxh.supabase.co/functions/v1/drive-import-client';
const IMPORT_SECRET = 'REPLACE_WITH_SECRET'; // <-- inserisci qui il segreto

function checkNewClientFolders() {
  const props = PropertiesService.getScriptProperties();
  const last = props.getProperty('lastCheck');
  const lastCheck = last ? new Date(last) : null;
  const runStart = new Date();

  const parent = DriveApp.getFolderById(FOLDER_ID);
  const it = parent.getFolders();
  const nuove = [];
  while (it.hasNext()) {
    const f = it.next();
    if (!lastCheck || f.getDateCreated() > lastCheck) {
      nuove.push({ id: f.getId(), name: f.getName() });
    }
  }

  // Primo avvio: imposta solo il "segnaposto temporale", non importa lo storico.
  if (!lastCheck) {
    props.setProperty('lastCheck', runStart.toISOString());
    Logger.log('Primo avvio: watermark impostato. Nessun import dello storico (%s cartelle ignorate).', nuove.length);
    return;
  }

  if (nuove.length) {
    const res = UrlFetchApp.fetch(FUNCTION_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-import-secret': IMPORT_SECRET },
      payload: JSON.stringify({ folders: nuove }),
      muteHttpExceptions: true,
    });
    Logger.log('Import: %s', res.getContentText());
  } else {
    Logger.log('Nessuna cartella nuova.');
  }
  props.setProperty('lastCheck', runStart.toISOString());
}

/** Installa il trigger ogni 15 minuti (esegui una volta). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkNewClientFolders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkNewClientFolders').timeBased().everyMinutes(15).create();
  // Imposta subito il watermark così lo storico non viene importato.
  checkNewClientFolders();
  Logger.log('Trigger installato: controllo ogni 15 minuti.');
}
