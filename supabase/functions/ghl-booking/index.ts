import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GHL_TOKEN = "pit-78a1afd7-7dca-40b2-8fed-21fd74e7185c";
const CALENDAR_ID = "CChGNv3OYX4rFHzx2UMI";
const LOCATION_ID = "KzCZHYcMDxOZMD7KBuZV";
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
    // GET SLOTS
    if (action === "slots") {
      const start = Date.now();
      const end = start + 14 * 86400 * 1000;

      const r = await fetch(
        `${GHL_BASE}/calendars/${CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}&timezone=Asia%2FDubai`,
        { headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15" } }
      );
      const text = await r.text();
      console.log("GHL slots raw:", text.substring(0, 500));

      let data;
      try { data = JSON.parse(text); } catch { data = { error: "Invalid JSON from GHL", raw: text.substring(0, 200) }; }

      return new Response(JSON.stringify(data), { headers: cors });
    }

    // BOOK APPOINTMENT
    if (action === "book" && req.method === "POST") {
      const body = await req.json();
      const { name, email, phone, slot_start, slot_end, timezone = "Asia/Dubai" } = body;

      // 1. Cerca contatto esistente
      let contactId: string | null = null;
      const searchR = await fetch(
        `${GHL_BASE}/contacts/search?locationId=${LOCATION_ID}&query=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15" } }
      );
      const searchData = await searchR.json();
      console.log("Contact search:", JSON.stringify(searchData).substring(0, 300));

      if (searchData.contacts?.length > 0) {
        contactId = searchData.contacts[0].id;
      } else {
        // Crea nuovo contatto
        const createR = await fetch(`${GHL_BASE}/contacts/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15", "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: LOCATION_ID,
            firstName: name.split(" ")[0],
            lastName: name.split(" ").slice(1).join(" ") || "",
            email,
            phone: phone || "",
            tags: ["lead-app", "indubai-lead"]
          })
        });
        const createData = await createR.json();
        console.log("Contact created:", JSON.stringify(createData).substring(0, 300));
        contactId = createData.contact?.id || createData.id;
      }

      if (!contactId) throw new Error("Impossibile creare contatto GHL");

      // 2. Crea appuntamento
      const apptBody = {
        calendarId: CALENDAR_ID,
        locationId: LOCATION_ID,
        contactId,
        startTime: slot_start,
        endTime: slot_end || "",
        title: `Consulenza InDubai — ${name}`,
        appointmentStatus: "confirmed",
        timezone
      };
      console.log("Creating appointment:", JSON.stringify(apptBody));

      const apptR = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-04-15", "Content-Type": "application/json" },
        body: JSON.stringify(apptBody)
      });
      const apptData = await apptR.json();
      console.log("Appointment result:", JSON.stringify(apptData).substring(0, 400));

      if (apptData.id || apptData.event?.id) {
        return new Response(JSON.stringify({ ok: true, appointment: apptData }), { headers: cors });
      } else {
        throw new Error(apptData.message || apptData.error || "Appointment creation failed");
      }
    }

    return new Response(JSON.stringify({ error: "Action not found" }), { status: 400, headers: cors });

  } catch (e) {
    console.error("ghl-booking error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
});
