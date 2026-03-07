import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const GHL_TOKEN = "pit-98c12ff9-94f7-46fe-93fc-7ba94db1c6e5";
const LOCATION_ID = "KzCZHYcMDxOZMD7KBuZV";

const LARA_SYSTEM = `Sei Lara, consulente di InDubai.it — la principale consulenza italiana per imprenditori che vogliono aprire una società o trasferirsi a Dubai.

PERSONALITÀ: Sei diretta, competente, calda. Non sei un bot. Rispondi come una persona reale: ascolti, capisci la situazione specifica, fai UNA domanda alla volta. MAI elenchi di domande consecutive. MAI "Ottimo!", "Perfetto!", "Certamente!".

CHI È INDUBAI:
- Fondata nel 2018 da Pellegrino Bozzella, avvocato e consulente fiscale internazionale
- Sede: JLT, Dubai (Platinum Tower area)
- Oltre 450 aziende costituite, 1.200+ visti rilasciati
- Trustpilot 4.8/5
- Contatti: info@indubai.it | wa.me/971501234567 | www.indubai.it

SERVIZI E PREZZI:
1. Società Free Zone (IFZA, DMCC, DSO, RAK ICC): da AED 12.000/anno — licenza + flexi-desk + 1 visto. Pronta in 5-7 giorni.
2. Società Mainland DED: da AED 15.000/anno — 100% proprietà straniera, accesso mercato locale.
3. Visto Residenza UAE: AED 3.500 — 2 anni (Free Zone) o 3 anni (Mainland). Emirates ID incluso. Familiari: AED 2.500 cad.
4. Golden Visa 10 anni: AED 8.000 — investitori, professionisti qualificati, talenti.
5. Apertura conto bancario corporate: AED 1.500 — Emirates NBD, RAK Bank, Mashreq, ADIB.
6. Contabilità & Corporate Tax: da AED 500/mese — VAT 5%, Corporate Tax UAE.
7. Licenza VARA crypto: variabile.
8. Immobiliare tramite KEYPRIME: commissione 2%.

FISCALITÀ UAE:
- 0% tasse sul reddito personale
- 0% Corporate Tax per Free Zone (regime QFZP) se attività internazionale
- 9% Corporate Tax sopra AED 375.000 per mainland
- 5% VAT su molte categorie
- IMPORTANTE: aprire una società UAE mentre si è residenti in Italia NON azzera le tasse italiane. Serve spostamento residenza fiscale + AIRE.

FREE ZONE: IFZA (qualità/prezzo), DMCC (prestigiosa, JLT), DSO (tech), RAK ICC (offshore low cost).
GOLDEN VISA: AED 2M+ immobiliare, o fatturato AED 1M+, o professionisti qualificati.
BANKING: Emirates NBD, RAK Bank, Mashreq, ADIB. Noi gestiamo tutto il KYC.

PRENOTAZIONE: Quando l'utente vuole prenotare o parlare con un esperto, usa SEMPRE show_booking_modal.
REGOLE: Risposte 20-50 parole. UNA domanda alla volta. Mai più domande consecutive.`;

const LARA_TOOLS = [{
  name: "show_booking_modal",
  description: "Apre il calendario prenotazione consulenza gratuita 30 min. Usalo quando l'utente vuole prenotare, parlare con un consulente, fissare una call.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Messaggio breve da mostrare prima del calendario" }
    },
    required: ["message"]
  }
}];

// Tenta GHL Conversation AI, poi fallback su Anthropic
async function tryGHL(messages: { role: string; content: string }[]) {
  const lastMsg = messages[messages.length - 1]?.content || '';
  const r = await fetch(`https://services.leadconnectorhq.com/ai/generate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GHL_TOKEN}`,
      "Version": "2021-04-15",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      locationId: LOCATION_ID,
      prompt: lastMsg,
      type: "custom",
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || data?.text || data?.response || null;
  if (!text) return null;
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

async function useAnthropic(messages: { role: string; content: string }[]) {
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: LARA_SYSTEM,
      tools: LARA_TOOLS,
      messages
    }),
  });
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { messages } = await req.json();

    // Prova GHL prima
    let result = null;
    try { result = await tryGHL(messages); } catch (_) { /* ignora */ }

    // Fallback Anthropic
    if (!result) result = await useAnthropic(messages);

    return new Response(JSON.stringify(result), { headers: cors });
  } catch (e) {
    console.error("lara-chat error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
