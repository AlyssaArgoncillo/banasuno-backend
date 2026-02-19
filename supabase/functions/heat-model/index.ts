/**
 * Supabase Edge Function: heat-model
 *
 * Accepts barangay list + raw temps (or city temp); returns temperatures and
 * optional PAGASA risk per barangay in the same shape the backend API uses.
 * Secure with HEAT_MODEL_KEY (set in Supabase secrets); call from backend only.
 *
 * Deploy: npx supabase functions deploy heat-model --no-verify-jwt
 */

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function tempToPAGASA(tempC: number): { level: number; label: string; score: number } {
  const t = tempC;
  if (t < 27) return { level: 1, label: "Not Hazardous", score: 0.1 };
  if (t <= 32) return { level: 2, label: "Caution", score: 0.2 + ((t - 27) / 5) * 0.2 };
  if (t <= 41) return { level: 3, label: "Extreme Caution", score: 0.4 + ((t - 33) / 8) * 0.2 };
  if (t <= 51) return { level: 4, label: "Danger", score: 0.6 + ((t - 42) / 9) * 0.2 };
  return { level: 5, label: "Extreme Danger", score: 0.8 + Math.min(0.2, (t - 52) / 20) };
}

interface BarangayInput {
  barangayId: string;
  lat: number;
  lng: number;
  temp_c?: number;
}

interface RequestBody {
  cityId?: string;
  barangays: BarangayInput[];
  cityTempC?: number;
  averageTempC?: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-heat-model-key",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = req.headers.get("x-heat-model-key");
  const expectedKey = Deno.env.get("HEAT_MODEL_KEY");
  if (!expectedKey || key !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const barangays = body?.barangays ?? [];
  const fallbackTemp = body.averageTempC ?? body.cityTempC;

  if (!Array.isArray(barangays) || barangays.length === 0) {
    return new Response(JSON.stringify({ error: "barangays array required and non-empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const temperatures: Record<string, number> = {};
  const risks: Record<string, { level: number; label: string; score: number; temp_c: number }> = {};

  for (const b of barangays) {
    const id = String(b?.barangayId ?? "").trim();
    if (!id) continue;
    const temp =
      typeof b.temp_c === "number" ? b.temp_c : typeof fallbackTemp === "number" ? fallbackTemp : null;
    if (temp === null) continue;

    const t = round1(temp);
    temperatures[id] = t;
    const pagasa = tempToPAGASA(t);
    risks[id] = {
      level: pagasa.level,
      label: pagasa.label,
      score: round1(clamp(pagasa.score, 0, 1)),
      temp_c: t,
    };
  }

  const values = Object.values(temperatures);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const averageTemp =
    values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : undefined;

  const payload = {
    temperatures,
    min,
    max,
    ...(averageTemp != null && { averageTemp }),
    risks,
    updatedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
