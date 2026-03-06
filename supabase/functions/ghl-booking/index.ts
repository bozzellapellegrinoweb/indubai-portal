import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GHL_TOKEN = "pit-78a1afd7-7dca-40b2-8fed-21fd74e7185c";
const CALENDAR_ID = "CChGNv3OYX4rFHzx2UMI";
const GHL_BASE = "https://services.leadconnectorhq.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // ── GET SLOTS ──────────────────────────────────────────
    if (action === "slots") {
      const start = Date.now();
      const end = start + 14 * 86400 * 1000; // 14 giorni

      const r = await fetch(
        `${GHL_BASE}/calendars/${CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}&timezone=Asia%2FDubai`,
        { headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15" } }
      );
      const data = await r.json();
      return new Response(JSON.stringify(data), { headers: cors });
    }

    // ── BOOK APPOINTMENT ──────────────────────────────────
    if (action === "book" && req.method === "POST") {
      const body = await req.json();
      const { name, email, phone, slot_start, slot_end, timezone = "Asia/Dubai" } = body;

      // 1. Crea o trova contatto GHL
      let contactId;
      const searchR = await fetch(
        `${GHL_BASE}/contacts/search?query=${encodeURIComponent(email)}&locationId=${Deno.env.get("GHL_LOCATION_ID") || ""}`,
        { headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15" } }
      );
      const searchData = await searchR.json();

      if (searchData.contacts?.length > 0) {
        contactId = searchData.contacts[0].id;
      } else {
        // Crea nuovo contatto
        const createR = await fetch(`${GHL_BASE}/contacts/`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GHL_TOKEN}`,
            Version: "2021-04-15",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            firstName: name.split(" ")[0],
            lastName: name.split(" ").slice(1).join(" ") || "",
            email,
            phone: phone || "",
            tags: ["lead-app"]
          })
        });
        const createData = await createR.json();
        contactId = createData.contact?.id;
      }

      if (!contactId) throw new Error("Impossibile creare contatto GHL");

      // 2. Crea appuntamento
      const apptR = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GHL_TOKEN}`,
          Version: "2021-04-15",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          calendarId: CALENDAR_ID,
          contactId,
          startTime: slot_start,
          endTime: slot_end,
          title: `Consulenza InDubai — ${name}`,
          appointmentStatus: "confirmed",
          timezone
        })
      });
      const apptData = await apptR.json();

      return new Response(JSON.stringify({ ok: true, appointment: apptData }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: "Action not found" }), { status: 400, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
