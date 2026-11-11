-- ============================================================
-- La knowledge base fiscale, per intero
-- ============================================================
-- I 20 topic di social-manager/lib/knowledge.ts erano entrati nel Cervello
-- come una riga di sintesi ciascuno: "CRS: il fisco italiano sa gia' del
-- conto a Dubai". Il fatto c'era, l'angolo no.
--
-- Il generatore invece passa al modello il gancio, il motivo per cui fa
-- paura, i punti chiave, i riferimenti normativi, l'errore comune, la
-- realta' e il cliffhanger. E' la differenza fra una storia di InDubai e
-- una voce di enciclopedia: la prima storia uscita dagli agenti era
-- corretta e anonima, e si vedeva.
--
-- Qui entrano interi. Il codice resta lo stesso (S-KB-<id>), quindi le
-- voci vecchie vengono sostituite, non duplicate.
-- ============================================================

insert into smm_brain (brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
select v.* from smm_brands b,
lateral (values
(b.id, 'studio', 'S-KB-zero-tax-myth', 'Zero tasse a Dubai: mito o realtà dopo il 2023?

GANCIO: Chi ti ha detto che a Dubai non si pagano tasse, ti ha detto una mezza verità. E le mezze verità, in fiscalità, costano care.
PERCHE'' FA PAURA: Chi opera dal 2023 senza registrazione CT rischia sanzioni FTA, accertamenti retroattivi e blocco del conto bancario UAE.

PUNTI CHIAVE:
- La Corporate Tax UAE è in vigore dal 1 giugno 2023 al 9% sopra AED 375.000
- Zero imposta dovuta è possibile con struttura corretta — zero obblighi è impossibile
- Registrazione CT obbligatoria anche se il reddito è sotto soglia
- La dichiarazione annuale è obbligatoria per tutti i soggetti registrati
- Le sanzioni per mancata registrazione partono da AED 10.000

RIFERIMENTI: Federal Decree-Law No. 47/2022; Ministerial Decision No. 73/2023
ERRORE COMUNE: Pensare che freezone = zero tasse automatiche. La Qualifying Free Zone Person ha condizioni stringenti che molti non rispettano.
LA REALTA'': Zero tasse sul reddito: possibile. Zero compliance, zero dichiarazioni: impossibile dal 2023. La differenza tra i due è ciò che separa chi dorme tranquillo da chi riceverà una lettera dall''FTA.
CLIFFHANGER: La domanda non è se paghi tasse. È se la tua struttura regge un controllo.',
   'social-manager/lib/knowledge.ts, topic zero-tax-myth',
   array['miti','myth_busting','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-rak-icc-holding-trap', 'La holding RAK ICC ti salva dalla Corporate Tax? Dipende.

GANCIO: C''è chi vende la holding offshore come la soluzione a tutto. Poi arriva l''Art. 50 della CT Law e la struttura crolla al primo controllo.
PERCHE'' FA PAURA: Una holding senza sostanza reale è esattamente il tipo di struttura che il GAAR (Art. 50) è stato scritto per colpire. L''FTA può disregardare l''intera struttura.

PUNTI CHIAVE:
- La RAK ICC non ha Corporate Tax — ma questo non significa che chi la usa sia esente
- La Participation Exemption (Art. 23) richiede condizioni precise: 5% di partecipazione, 12 mesi di detenzione, imposta comparabile al 9%
- Una LLC disregarded entity USA non soddisfa il requisito di imposta comparabile
- Il GAAR Art. 50 colpisce strutture senza ragione commerciale reale il cui scopo principale è ottenere un vantaggio fiscale
- Sostanza reale significa: amministratore indipendente, decisioni documentate, governance effettiva

RIFERIMENTI: Art. 23 CT Law — Participation Exemption; Art. 50 CT Law — General Anti-Abuse Rule; Cabinet Decision No. 56/2023
ERRORE COMUNE: Interporre una holding RAK ICC tra la persona fisica e la società operativa pensando che questo elimini la CT. In realtà sposta il problema di un livello e aggiunge costi.
LA REALTA'': La holding ha senso con ragioni commerciali reali: protezione patrimoniale, più soci, successoria, IP, multi-giurisdizione. Se la ragione è solo ''non pagare CT'', è una posizione indifendibile.
CLIFFHANGER: Chi te l''ha venduta come soluzione, ti ha spiegato cosa succede quando l''FTA applica l''Art. 50?',
   'social-manager/lib/knowledge.ts, topic rak-icc-holding-trap',
   array['strutture','structure_trap','esperto','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-poem-invisible-trap', 'POEM: la trappola che rende tassabile la tua offshore

GANCIO: Hai una società offshore che gestisci dal tuo ufficio a Dubai? Complimenti, potresti aver appena creato un soggetto passivo CT UAE senza saperlo.
PERCHE'' FA PAURA: Se il Place of Effective Management della tua offshore è negli UAE, l''FTA la considera residente fiscale UAE — con obbligo CT pieno.

PUNTI CHIAVE:
- POEM = Place of Effective Management: dove vengono prese le decisioni strategiche chiave
- Se il POEM di una entità estera è negli UAE, quella entità diventa residente fiscale UAE
- Non conta dove è registrata la società — conta dove si prendono le decisioni
- Indicatori: riunioni del board, firma contratti, gestione bancaria, residenza degli amministratori
- Anche una società in giurisdizione zero-tax diventa soggetta a CT UAE se il POEM è qui

RIFERIMENTI: Art. 11(3) CT Law; Art. 14 CT Law — Permanent Establishment; Ministerial Decision No. 27/2023
ERRORE COMUNE: Gestire una BVI, Seychelles o RAK ICC dal proprio laptop a Dubai pensando che la giurisdizione di registrazione sia l''unica cosa che conta.
LA REALTA'': L''FTA segue la sostanza, non la forma. Se le tue decisioni partono da Dubai, la tua società è fiscalmente a Dubai — indipendentemente da dove l''hai costituita.
CLIFFHANGER: Quante delle tue decisioni aziendali partono dagli UAE? La risposta a questa domanda determina dove paghi le tasse.',
   'social-manager/lib/knowledge.ts, topic poem-invisible-trap',
   array['compliance','compliance_bomb','avanzato','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-qfzp-conditions', 'Qualifying Free Zone Person: le 7 condizioni che nessuno ti spiega

GANCIO: La freezone ti ha detto che sei esente da Corporate Tax. Ma hai verificato se rispetti tutte e 7 le condizioni per essere QFZP?
PERCHE'' FA PAURA: Basta violare una sola condizione per perdere lo status QFZP retroattivamente. Da 0% passi al 9% su tutto il reddito dell''anno — con sanzioni.

PUNTI CHIAVE:
- Mantenere sostanza adeguata nella Free Zone (ufficio, dipendenti, spese operative reali)
- Derivare reddito qualificato (qualifying income) — non tutto il reddito da freezone è qualificato
- Non aver optato per il regime ordinario
- Rispettare i requisiti di transfer pricing per transazioni con parti correlate
- Il reddito da transazioni con mainland UAE può essere non-qualificato
- La de minimis rule: se il reddito non qualificato supera il minore tra AED 5M e il 5% del totale, perdi lo status su tutto
- Audit trail e documentazione obbligatoria

RIFERIMENTI: Art. 18 CT Law; Cabinet Decision No. 55/2023; Ministerial Decision No. 265/2023
ERRORE COMUNE: Aprire in freezone, fatturare clienti mainland, e assumere di essere a 0%. Il reddito da clienti UAE mainland è generalmente non-qualifying income.
LA REALTA'': Il regime QFZP è vantaggioso ma fragile. Richiede monitoraggio continuo e documentazione impeccabile. Non è un ''apri e dimentica''.
CLIFFHANGER: Sai quale percentuale del tuo reddito è effettivamente qualifying income? Se non lo sai, hai un problema.',
   'social-manager/lib/knowledge.ts, topic qfzp-conditions',
   array['normativa','tax_deep_dive','avanzato','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-aire-not-enough', 'Ti sei iscritto all''AIRE? Non basta. Ecco cosa guarda l''Agenzia delle Entrate.

GANCIO: L''iscrizione AIRE è il primo passo. Ma l''Agenzia delle Entrate ha 6 criteri per stabilire se sei ancora fiscalmente italiano — e l''AIRE è solo uno di questi.
PERCHE'' FA PAURA: Accertamento per residenza fiscale fittizia: tassazione mondiale in Italia su tutto il reddito estero, con sanzioni dal 100% al 200% dell''imposta evasa.

PUNTI CHIAVE:
- Centro degli interessi vitali: famiglia, patrimonio, relazioni sociali ed economiche prevalenti
- Domicilio vs residenza: sono concetti diversi e l''AdE li verifica entrambi
- I 183 giorni non sono l''unico criterio — è sufficiente uno solo tra domicilio, residenza e sede principale di interessi
- Mantenere immobili, conti correnti attivi, utenze, auto immatricolate in Italia sono indicatori negativi
- La prova contraria spetta al contribuente: devi dimostrare tu di non essere residente
- Dal 2024 il criterio è cambiato: basta la presenza in Italia per la maggior parte del periodo d''imposta

RIFERIMENTI: Art. 2 TUIR; Art. 2-bis TUIR (dal 2024); Convenzione Italia-UAE contro le doppie imposizioni; Circolare AdE 25/E/2024
ERRORE COMUNE: Iscriversi all''AIRE, prendere il volo per Dubai, mantenere moglie e figli in Italia, continuare a gestire il business italiano da remoto, e pensare di essere a posto.
LA REALTA'': L''AIRE è necessaria ma non sufficiente. L''Agenzia delle Entrate guarda la sostanza: dove vivi davvero, dove sono i tuoi affetti, dove prendi le decisioni, dove spendi i tuoi soldi.
CLIFFHANGER: Se domani l''AdE ti mandasse un questionario, quante delle tue risposte punterebbero ancora all''Italia?',
   'social-manager/lib/knowledge.ts, topic aire-not-enough',
   array['residenza','relocation_mistake','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-substance-requirements', 'Substance a Dubai: non basta una scrivania e un telefono

GANCIO: Hai aperto la società, hai la licenza, hai il visto. Ma se non hai sostanza economica reale, la tua freezone è un guscio vuoto con un problema fiscale dentro.
PERCHE'' FA PAURA: Mancanza di Economic Substance può portare a: perdita status QFZP, scambio spontaneo di informazioni con l''Italia, reclassificazione come PE in altra giurisdizione.

PUNTI CHIAVE:
- Economic Substance Regulations: livello adeguato di dipendenti qualificati, spese operative, asset fisici
- Le core income-generating activities (CIGA) devono essere svolte negli UAE
- Ufficio virtuale o flexi-desk: accettabile per alcune attività, insufficiente per altre
- La sostanza deve essere proporzionata al fatturato e alla natura del business
- Le società holding hanno requisiti di sostanza ridotti ma non nulli
- La documentazione deve provare attività reale: contratti, fatture fornitori locali, presenze fisiche

RIFERIMENTI: Cabinet Resolution No. 57/2020 — Economic Substance Regulations; Art. 18 CT Law requisiti QFZP
ERRORE COMUNE: Aprire con un pacchetto ''tutto incluso'' da 5.000 AED/anno con flexi-desk, nessun dipendente, e fatturare centinaia di migliaia di euro a clienti esteri.
LA REALTA'': La sostanza costa. Ma costa molto meno di un accertamento. Il rapporto costo/beneficio è sempre a favore della sostanza reale.
CLIFFHANGER: Se l''FTA venisse domani nel tuo ufficio, cosa troverebbe? Se la risposta è ''niente'', hai la tua risposta.',
   'social-manager/lib/knowledge.ts, topic substance-requirements',
   array['compliance','compliance_bomb','avanzato']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-transfer-pricing-trap', 'Transfer pricing tra le tue società: il rischio che ignori

GANCIO: Hai una società in freezone e una mainland? Oppure una in UAE e una in Italia? Come stabilisci i prezzi tra loro fa la differenza tra compliance e accertamento.
PERCHE'' FA PAURA: L''FTA può rettificare i prezzi infragruppo e tassare il reddito che consideri hai spostato artificialmente. Con sanzioni e interessi.

PUNTI CHIAVE:
- Arm''s length principle: le transazioni tra parti correlate devono avvenire a condizioni di mercato
- Master file e local file obbligatori per fatturati sopra soglia
- Anche le transazioni tra freezone e mainland UAE sono soggette a transfer pricing
- Management fees, royalties, servizi infragruppo: ogni flusso deve essere giustificato e documentato
- Benchmarking study: analisi di comparabilità necessaria per dimostrare la congruità dei prezzi
- L''Italia ha una delle normative TP più aggressive d''Europa — se hai ancora società italiane, doppio rischio

RIFERIMENTI: Art. 34-39 CT Law; Ministerial Decision No. 97/2023 — Transfer Pricing; OECD TP Guidelines
ERRORE COMUNE: Fatturare dalla freezone alla mainland (o viceversa) a prezzi ''di comodo'' per concentrare il reddito dove la tassazione è zero. L''FTA conosce benissimo questo schema.
LA REALTA'': Il transfer pricing non è un optional. È un obbligo legale con documentazione formale richiesta. Chi non lo fa sta costruendo una bomba a orologeria.
CLIFFHANGER: Quanto del tuo reddito passa tra entità collegate? E chi ha deciso quei prezzi?',
   'social-manager/lib/knowledge.ts, topic transfer-pricing-trap',
   array['normativa','tax_deep_dive','esperto']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-small-business-relief-trap', 'Small Business Relief: la scorciatoia che può costarti cara

GANCIO: Fatturi meno di 3 milioni AED? Lo Small Business Relief ti esenta dalla CT. Perfetto. Ma hai letto le condizioni?
PERCHE'' FA PAURA: Se opti per lo SBR, non puoi riportare perdite. Se il prossimo anno superi la soglia, quelle perdite sono perse per sempre.

PUNTI CHIAVE:
- Soglia: ricavi fino a AED 3.000.000 nel periodo d''imposta corrente e in tutti i periodi precedenti
- Non disponibile per QFZP e membri di gruppi multinazionali
- Optando per SBR rinunci al riporto delle perdite dell''anno
- Se prevedi crescita, rinunciare alle perdite iniziali può costare molto più della CT risparmiata
- La scelta è annuale: puoi optare un anno sì e uno no, ma le perdite non recuperate sono perse
- Non esenta dagli obblighi di registrazione e dichiarazione — solo dall''imposta

RIFERIMENTI: Art. 21 CT Law; Ministerial Decision No. 73/2023
ERRORE COMUNE: Scegliere automaticamente lo SBR perché ''tanto fatturi poco'', senza considerare il piano di crescita e il valore delle perdite riportabili.
LA REALTA'': Lo SBR è utile per micro-attività stabili. Per startup o business in crescita, può essere la scelta più costosa che fai.
CLIFFHANGER: Hai calcolato quanto valgono le tue perdite degli primi anni? Potresti star regalando deduzioni future per risparmiare zero oggi.',
   'social-manager/lib/knowledge.ts, topic small-business-relief-trap',
   array['normativa','myth_busting','avanzato','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-bank-account-compliance', 'Il conto in banca UAE: il guardiano che può bloccarti tutto

GANCIO: Hai la società, i clienti, il fatturato. Ma la banca ti chiede 47 documenti, ti blocca un bonifico, ti chiude il conto. Benvenuto nel KYC emiratino.
PERCHE'' FA PAURA: Le banche UAE segnalano direttamente all''FTA e al Financial Intelligence Unit. Un profilo di rischio alto può portare a indagini e congelamento fondi.

PUNTI CHIAVE:
- Enhanced Due Diligence per non residenti e strutture complesse
- Source of funds e source of wealth: devi documentare ogni flusso significativo
- Le banche rifiutano aperture per strutture senza sostanza visibile
- CRS (Common Reporting Standard): il tuo conto UAE viene segnalato automaticamente al tuo paese di residenza fiscale
- UBO (Ultimate Beneficial Owner): la banca deve sapere chi c''è davvero dietro
- Transazioni con paesi in lista nera o grigia FATF: scrutinio extra automatico

RIFERIMENTI: Federal Decree-Law No. 20/2018 — Anti Money Laundering; CRS — OECD Automatic Exchange; FATF Recommendations
ERRORE COMUNE: Pensare che la banca sia solo un servizio. La banca UAE è il primo livello di enforcement. Se la tua struttura non convince la banca, non convincerà nemmeno l''FTA.
LA REALTA'': Il compliance bancario UAE è tra i più rigidi al mondo. Non è un ostacolo — è un filtro. Chi ha una struttura pulita non ha problemi. Chi ha qualcosa da nascondere, sì.
CLIFFHANGER: La tua banca ti ha mai chiesto di giustificare l''origine dei fondi? Se non l''ha ancora fatto, lo farà.',
   'social-manager/lib/knowledge.ts, topic bank-account-compliance',
   array['compliance','compliance_bomb','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-exit-tax-italy', 'Exit tax: l''Italia ti tassa anche quando te ne vai

GANCIO: Stai trasferendo la tua società fuori dall''Italia? Lo Stato italiano vuole la sua parte sulle plusvalenze latenti. Prima che tu esca.
PERCHE'' FA PAURA: La exit tax si applica sulle plusvalenze non realizzate al momento del trasferimento. Puoi ritrovarti a dover pagare imposte su guadagni che non hai ancora incassato.

PUNTI CHIAVE:
- Art. 166 TUIR: tassazione delle plusvalenze latenti al momento del trasferimento di residenza della società
- Si applica anche alle persone fisiche con partecipazioni qualificate (Art. 166-bis TUIR)
- Il valore viene determinato al fair market value al momento del trasferimento
- Opzione di rateizzazione possibile verso paesi UE/SEE con accordi di cooperazione
- Per trasferimenti extra-UE (come verso UAE): pagamento immediato
- Include anche IP, avviamento, e asset immateriali — non solo partecipazioni

RIFERIMENTI: Art. 166 TUIR; Art. 166-bis TUIR; Direttiva ATAD (UE) 2016/1164
ERRORE COMUNE: Pianificare il trasferimento a Dubai senza considerare la exit tax. Scoprirla a posteriori quando il commercialista italiano fa la dichiarazione.
LA REALTA'': La exit tax non è evitabile, ma è pianificabile. Il timing, la valutazione degli asset, e la struttura del trasferimento possono fare una differenza enorme.
CLIFFHANGER: Hai fatto una valutazione degli asset latenti prima di pianificare il trasferimento? Se no, potresti avere una sorpresa.',
   'social-manager/lib/knowledge.ts, topic exit-tax-italy',
   array['residenza','relocation_mistake','esperto']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-convenzione-italia-uae', 'Convenzione Italia-UAE: cosa copre davvero (e cosa no)

GANCIO: Hai sentito che c''è una convenzione contro le doppie imposizioni tra Italia e UAE. Ma sai cosa dice veramente? Spoiler: non dice quello che pensi.
PERCHE'' FA PAURA: Invocare la convenzione in modo errato in una dichiarazione è falsa applicazione di trattato — con sanzioni specifiche.

PUNTI CHIAVE:
- La convenzione esiste ed è in vigore, ma non copre tutti i tipi di reddito allo stesso modo
- Redditi d''impresa: tassati solo nel paese di residenza SE non c''è stabile organizzazione nell''altro
- Dividendi: ritenuta massima del 5% o 15% a seconda della partecipazione
- Royalties e canoni: possono essere tassati in entrambi i paesi
- Capital gains: regole diverse per immobili, partecipazioni qualificate, e altri asset
- Clausola del beneficiario effettivo: se non sei il beneficial owner, la convenzione non si applica
- La clausola LOB (Limitation on Benefits) può escludere strutture artificiose

RIFERIMENTI: Convenzione Italia-UAE del 22/01/1995; Protocollo aggiuntivo 2011; Art. 10-12 Modello OCSE
ERRORE COMUNE: Pensare che la convenzione significhi automaticamente ''non pago tasse in Italia''. La convenzione ripartisce la potestà impositiva — non la elimina.
LA REALTA'': La convenzione è uno strumento potente, ma tecnico. Applicarla correttamente richiede analisi caso per caso del tipo di reddito, della struttura, e dello status di residenza.
CLIFFHANGER: Sai quale articolo della convenzione si applica al tuo tipo di reddito? Se non lo sai, come fai a sapere dove paghi le tasse?',
   'social-manager/lib/knowledge.ts, topic convenzione-italia-uae',
   array['normativa','tax_deep_dive','avanzato']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-freelancer-dubai-mistake', 'Freelancer a Dubai: il visto non è una strategia fiscale

GANCIO: Hai preso il freelance permit, lavori dal laptop, fatturi all''estero. Pensi di essere a posto. Ma il fisco — italiano e emiratino — la vede diversamente.
PERCHE'' FA PAURA: Senza registrazione CT e senza cancellazione dalla residenza fiscale italiana, rischi doppia imposizione non recuperabile.

PUNTI CHIAVE:
- Il freelance permit UAE genera un obbligo di registrazione CT dal 2023
- Il reddito da lavoro autonomo è reddito d''impresa ai fini CT UAE
- Se mantieni clienti italiani e lavori per loro da Dubai, l''Italia potrebbe considerarti stabile organizzazione personale
- Il freelancer è una persona fisica con attività: entrambe le giurisdizioni possono tassare
- La Convenzione Italia-UAE aiuta, ma solo se la residenza fiscale è correttamente in un solo paese
- Il rischio più grande: essere residenti fiscali in entrambi i paesi contemporaneamente

RIFERIMENTI: Art. 11 CT Law; Art. 2 TUIR; Art. 5 Convenzione Italia-UAE — Stabile organizzazione
ERRORE COMUNE: Prendere un freelance visa a Dubai, continuare a lavorare per gli stessi clienti italiani, non registrarsi alla CT UAE, non cancellarsi dall''Italia. Massimo rischio su tutti i fronti.
LA REALTA'': Il freelancer a Dubai può funzionare benissimo. Ma richiede pianificazione: residenza fiscale definita, CT registration, compliance locale, e disengagement dall''Italia.
CLIFFHANGER: Se lavori per clienti italiani da Dubai, hai verificato dove si crea la tua stabile organizzazione?',
   'social-manager/lib/knowledge.ts, topic freelancer-dubai-mistake',
   array['residenza','relocation_mistake','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-permanent-establishment-risk', 'Stabile organizzazione: il rischio che non vedi

GANCIO: Hai una società a Dubai ma i tuoi dipendenti firmano contratti dall''Italia. Hai appena creato una stabile organizzazione — e l''Italia tassa quel reddito.
PERCHE'' FA PAURA: L''Agenzia delle Entrate può imputare il reddito della società emiratina all''Italia e tassarlo con IRES + IRAP + sanzioni.

PUNTI CHIAVE:
- PE fissa: ufficio, sede di direzione, succursale, cantiere >12 mesi nel paese
- PE personale: un agente dipendente che conclude contratti abitualmente nel paese per conto della società estera
- Non serve un ufficio fisico: basta un dipendente o collaboratore che opera stabilmente
- Anche un socio che ''aiuta'' dall''Italia può costituire PE se ha poteri decisionali
- La PE genera obbligo dichiarativo e imposte nel paese dove si trova
- L''Italia è particolarmente aggressiva nell''accertamento di PE occulte

RIFERIMENTI: Art. 162 TUIR; Art. 5 Convenzione Italia-UAE; Art. 14 CT Law UAE
ERRORE COMUNE: Costituire la società a Dubai, spostare la residenza, ma lasciare operativi in Italia (dipendenti, collaboratori, familiari) che di fatto gestiscono il business.
LA REALTA'': La PE non è una questione teorica. L''AdE la cerca attivamente, specialmente per società in giurisdizioni a bassa fiscalità. E le trova.
CLIFFHANGER: Chi opera per la tua società emiratina? E da dove lo fa?',
   'social-manager/lib/knowledge.ts, topic permanent-establishment-risk',
   array['strutture','structure_trap','avanzato','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-crypto-dubai-tax', 'Crypto a Dubai: davvero zero tasse? Non così in fretta.

GANCIO: Dubai è il paradiso crypto. Nessuna tassa sulle plusvalenze. Fino a quando non scopri che l''FTA ha un''opinione diversa.
PERCHE'' FA PAURA: Le crypto-attività gestite tramite società UAE sono soggette a CT. Le plusvalenze personali potrebbero essere tassate come reddito d''impresa se l''attività è abituale.

PUNTI CHIAVE:
- Persone fisiche: nessuna imposta sulle plusvalenze crypto personali (per ora)
- Società: i proventi crypto sono reddito d''impresa soggetto a CT al 9%
- Trading abituale da persona fisica: l''FTA può riqualificarlo come attività d''impresa
- VARA (Virtual Assets Regulatory Authority): obbligo di licenza per operatori crypto a Dubai
- Staking, yield farming, mining: la classificazione fiscale non è ancora chiara — rischio interpretativo
- Obbligo di disclosure alla banca: le cripto-transazioni sono monitorate sotto AML
- L''Italia tassa le crypto al 26% (42% dal 2026) — se la residenza fiscale non è pulita, paghi lì

RIFERIMENTI: CT Law Art. 11-12; VARA Regulations 2023; Art. 67 comma 1 lett. c-sexies TUIR
ERRORE COMUNE: Trasferirsi a Dubai solo per le crypto, senza strutturare correttamente la residenza fiscale e senza considerare la CT per l''attività svolta tramite società.
LA REALTA'': Dubai è effettivamente vantaggiosa per le crypto. Ma il vantaggio è reale solo con struttura e residenza corrette. Altrimenti stai solo spostando il problema.
CLIFFHANGER: La tua attività crypto è personale o d''impresa? La risposta cambia tutto.',
   'social-manager/lib/knowledge.ts, topic crypto-dubai-tax',
   array['miti','myth_busting','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-crs-automatic-exchange', 'CRS: il fisco italiano sa già del tuo conto a Dubai

GANCIO: Pensi che il tuo conto emiratino sia invisibile al fisco italiano? Dal 2018 gli UAE scambiano automaticamente le informazioni finanziarie con l''Italia.
PERCHE'' FA PAURA: Conto non dichiarato nel quadro RW: sanzione dal 3% al 15% del saldo. Se in paese black list: dal 6% al 30%. Per ogni anno.

PUNTI CHIAVE:
- CRS (Common Reporting Standard): scambio automatico annuale tra UAE e Italia (e 100+ paesi)
- Le banche UAE comunicano: saldi, interessi, dividendi, proventi da vendita titoli
- Anche i conti societari con UBO italiano vengono segnalati
- Il quadro RW della dichiarazione italiana è obbligatorio per qualsiasi attività finanziaria estera
- La voluntary disclosure non è più disponibile — le sanatorie hanno una finestra limitata
- L''Agenzia delle Entrate incrocia i dati CRS con le dichiarazioni — automaticamente

RIFERIMENTI: OECD CRS; D.L. 167/1990 — Monitoraggio fiscale; Art. 4 D.L. 167/1990 — Sanzioni RW
ERRORE COMUNE: Non dichiarare il conto UAE nel quadro RW perché ''tanto Dubai è lontana e non scambiano informazioni''. Scambiano dal 2018.
LA REALTA'': La trasparenza fiscale internazionale è totale. Non esiste più il segreto bancario tra Italia e UAE. Chi non dichiara sta solo aspettando la lettera.
CLIFFHANGER: Il tuo commercialista italiano sa del tuo conto emiratino? Se non lo sa, chi sta compilando il tuo quadro RW?',
   'social-manager/lib/knowledge.ts, topic crs-automatic-exchange',
   array['compliance','compliance_bomb','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-mainland-vs-freezone-real', 'Mainland vs Freezone: la verità che il consulente non ti dice

GANCIO: Freezone = zero tasse. Mainland = 9%. Giusto? Sbagliato. La realtà è molto più sfumata — e la scelta sbagliata ti costa cara.
PERCHE'' FA PAURA: Aprire in freezone per risparmiare la CT e poi scoprire che il tuo reddito non è qualifying. Paghi 9% comunque, più i costi extra della freezone.

PUNTI CHIAVE:
- Freezone 0% vale solo per Qualifying Income — il reddito da clienti UAE mainland è generalmente non-qualifying
- Mainland: CT al 9% ma accesso diretto al mercato UAE senza restrizioni
- Freezone: costi di licenza spesso più alti, limiti su attività con clienti UAE
- La distinzione ''qualifying vs non-qualifying income'' è complessa e dipende dal tipo di attività
- Freezone con QFZP + reddito estero: struttura ottimale, ma richiede sostanza e compliance rigorosa
- Mainland con SBR sotto AED 3M: in pratica zero CT con meno vincoli

RIFERIMENTI: Art. 18 CT Law — QFZP; Cabinet Decision 55/2023; Ministerial Decision 265/2023
ERRORE COMUNE: Scegliere mainland o freezone basandosi solo sull''aliquota fiscale nominale, senza analizzare il tipo di clienti, la natura del reddito, e i requisiti di sostanza.
LA REALTA'': Non esiste una risposta universale. La scelta dipende da: chi sono i tuoi clienti, dove generano il reddito, che tipo di attività svolgi, e quanto sei disposto a investire in compliance.
CLIFFHANGER: Hai scelto la tua giurisdizione basandoti su un''analisi fiscale completa, o sulla brochure della freezone?',
   'social-manager/lib/knowledge.ts, topic mainland-vs-freezone-real',
   array['strutture','structure_trap','base','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-beneficial-ownership', 'Beneficial Ownership: chi è il vero titolare della tua società?

GANCIO: Hai messo un nominee director? Un fiduciario? Un familiare come azionista? L''FTA, la banca e il fisco italiano vogliono sapere chi c''è davvero dietro.
PERCHE'' FA PAURA: La mancata dichiarazione del UBO (Ultimate Beneficial Owner) è violazione AML con conseguenze penali in UAE. In Italia, omessa dichiarazione nel quadro RW.

PUNTI CHIAVE:
- UBO Register: obbligo per tutte le società UAE di dichiarare il titolare effettivo
- La soglia è 25% di partecipazione diretta o indiretta, o controllo effettivo
- Strutture fiduciarie e nominee arrangements non nascondono il UBO — lo dichiarano
- Le banche verificano il UBO indipendentemente dalla struttura societaria
- In Italia: l''UBO di società estere va dichiarato anche ai fini del quadro RW
- Le sanzioni AML in UAE includono multe fino a AED 1.000.000 e potenziale reclusione

RIFERIMENTI: Cabinet Decision No. 58/2020 — UBO Regulations; Federal Decree-Law No. 20/2018 — AML; Art. 4 D.L. 167/1990
ERRORE COMUNE: Usare strutture complesse con nominee per ''nascondere'' la titolarità. Nel 2026, tra CRS, UBO register, e AML enforcement, la trasparenza è quasi totale.
LA REALTA'': La privacy patrimoniale è un diritto legittimo. L''occultamento della titolarità è un reato. La linea tra i due è la compliance.
CLIFFHANGER: Se qualcuno chiedesse alla tua banca chi è il vero proprietario della tua società, cosa risponderebbe?',
   'social-manager/lib/knowledge.ts, topic beneficial-ownership',
   array['compliance','compliance_bomb','avanzato']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-vat-uae-surprise', 'VAT 5% negli UAE: la tassa che tutti dimenticano

GANCIO: Tutti parlano della Corporate Tax. Ma sai che gli UAE hanno anche la VAT al 5% dal 2018? E che molti non la applicano correttamente?
PERCHE'' FA PAURA: Mancata registrazione VAT con superamento soglia: sanzione AED 20.000. Mancata dichiarazione: AED 1.000 per la prima volta, AED 2.000 per le successive.

PUNTI CHIAVE:
- Soglia di registrazione obbligatoria: AED 375.000 di fatturato negli ultimi 12 mesi
- Soglia di registrazione volontaria: AED 187.500
- Servizi B2B internazionali: spesso esenti o a tasso zero, ma con obbligo di reverse charge per il cliente
- Servizi digitali: regole specifiche per la determinazione del luogo di fornitura
- La VAT non dichiarata non scompare — l''FTA può accertare retroattivamente fino a 5 anni
- Input VAT recovery: possibile solo con fatture conformi e registrazione attiva

RIFERIMENTI: Federal Decree-Law No. 8/2017 — VAT; Cabinet Decision No. 52/2017 — VAT Regulations
ERRORE COMUNE: Fatturare servizi senza VAT perché ''sono per clienti esteri''. La zero-rating si applica solo se le condizioni sono rispettate — non è automatica.
LA REALTA'': La VAT è semplice nella struttura ma insidiosa nei dettagli. Il 5% sembra poco, ma le sanzioni per errori di compliance sono sproporzionate.
CLIFFHANGER: Stai applicando correttamente la VAT sulle tue fatture? Sei sicuro?',
   'social-manager/lib/knowledge.ts, topic vat-uae-surprise',
   array['normativa','myth_busting','base']::text[], 60, false, true),
(b.id, 'studio', 'S-KB-family-business-succession', 'Business di famiglia a Dubai: e se domani non ci sei più?

GANCIO: Hai costruito tutto a Dubai. Società, conti, immobili. Ma se domani ti succede qualcosa, i tuoi eredi sanno come accedere? E il fisco cosa fa?
PERCHE'' FA PAURA: Senza pianificazione successoria UAE, i conti vengono congelati, la società bloccata, e gli eredi devono passare dalla Sharia Court — anche i non musulmani.

PUNTI CHIAVE:
- In assenza di testamento registrato DIFC, si applica la Sharia per la successione
- I conti bancari vengono congelati immediatamente alla notifica del decesso
- La società può essere bloccata se l''unico amministratore/azionista è deceduto
- DIFC Wills Service: testamento in lingua inglese registrato che deroga alla Sharia
- I costi DIFC partono da circa USD 10.000 ma proteggono l''intero patrimonio UAE
- In Italia: l''imposta di successione si applica sui beni mondiali del defunto residente — o sui beni italiani del non residente

RIFERIMENTI: Federal Law No. 28/2005 — Personal Status Law; DIFC Wills and Probate Registry; D.Lgs. 346/1990 — Imposta sulle successioni
ERRORE COMUNE: Non fare testamento DIFC perché ''sono giovane'' o ''ci penserò dopo''. Quando serve, è troppo tardi per farlo.
LA REALTA'': La pianificazione successoria non è un lusso. È un obbligo verso la tua famiglia. A Dubai, senza pianificazione, il caos è garantito.
CLIFFHANGER: Se domani mattina il tuo telefono smettesse di squillare, la tua famiglia saprebbe cosa fare?',
   'social-manager/lib/knowledge.ts, topic family-business-succession',
   array['strutture','structure_trap','avanzato','virale']::text[], 75, false, true),
(b.id, 'studio', 'S-KB-double-taxation-real-risk', 'Doppia imposizione: quando paghi le tasse in due paesi

GANCIO: Ti sei trasferito a Dubai per pagare meno tasse. Ma se la struttura non è pulita, finisci per pagarle in due paesi. E il credito d''imposta non sempre copre.
PERCHE'' FA PAURA: Doppia residenza fiscale = doppia imposizione. La convenzione aiuta solo se la residenza è chiara. In caso di conflitto, il tie-breaker non è automatico.

PUNTI CHIAVE:
- Doppia residenza: possibile essere considerati residenti fiscali sia in Italia che negli UAE contemporaneamente
- La convenzione prevede un tie-breaker rule (Art. 4): abitazione permanente → centro interessi vitali → soggiorno abituale → nazionalità
- Il tie-breaker richiede analisi caso per caso — non è un automatismo
- Anche con tie-breaker risolto, certi redditi possono essere tassati in entrambi i paesi (es. dividendi, royalties)
- Il credito d''imposta per le tasse pagate all''estero ha limiti e condizioni
- L''onere della prova è sempre sul contribuente — devi dimostrare dove sei residente

RIFERIMENTI: Art. 4 Convenzione Italia-UAE; Art. 165 TUIR — Credito d''imposta estero; Art. 2 TUIR
ERRORE COMUNE: Assumere che il trasferimento a Dubai risolva automaticamente la questione della residenza fiscale. Senza documentazione e sostanza, l''Italia continua a considerarti residente.
LA REALTA'': Il trasferimento fiscale non è un evento — è un processo. Richiede mesi di preparazione, documentazione, e poi mantenimento continuo della posizione.
CLIFFHANGER: Se domani sia l''Italia che Dubai ti chiedessero le tasse sullo stesso reddito, quale dei due paesi ha ragione?',
   'social-manager/lib/knowledge.ts, topic double-taxation-real-risk',
   array['residenza','relocation_mistake','avanzato','virale']::text[], 75, false, true)
) as v(brand_id, tipo, codice, testo, fonte, tags, peso, vincolante, confermata)
-- L'indice unico sul codice e' parziale (solo dove codice non e' nullo):
-- senza ripetere la stessa condizione qui, Postgres non lo riconosce come
-- bersaglio del conflitto e rifiuta l'istruzione.
on conflict (brand_id, codice) where codice is not null do update
   set testo = excluded.testo,
       fonte = excluded.fonte,
       tags  = excluded.tags,
       peso  = excluded.peso,
       updated_at = now();
