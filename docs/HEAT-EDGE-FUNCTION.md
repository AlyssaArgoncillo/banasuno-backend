# Using a Supabase Edge Function as the heat model

You can run the **heat model** (heuristic or ML) in a **Supabase Edge Function**. The Node backend calls it with barangay list and raw temps; the function returns the same JSON shape your API already uses (`temperatures`, `min`, `max`, optional `risks`), so the backend stays thin and the model can be swapped (e.g. heuristic → ML) without changing the API contract.

---

## 1. Overview

- **Edge Function** (Deno): `heat-model` – receives barangay IDs + centroids and either raw temps per barangay or a single city temp; applies your logic (heuristic or proxy to ML); returns `{ temperatures, min, max, averageTemp?, risks? }`.
- **Backend**: Optional. The backend does **not** currently call this Edge Function; heat routes use the built-in heuristic in `src/services/heatRiskModel.js`. To use the Edge Function, add a client in the backend that POSTs to it when `HEAT_MODEL_URL` and `HEAT_MODEL_KEY` are set, and have the heat route call that client instead of (or in addition to) the local heuristic.

**Why Edge Function?**

- Same auth pattern as your existing `heat-snapshot-writer` (key in header, server-side only).
- Can later call an external ML service from inside the function (e.g. Python microservice, Replicate) and map the result to the contract.
- Keeps model logic in one place; backend only orchestrates (fetch raw data → call model → return).

---

## 2. Create and deploy the Edge Function

### 2.1 Create the function locally

From the repo root (where `supabase/` lives or will be created):

```bash
npx supabase functions new heat-model
```

This creates `supabase/functions/heat-model/index.ts`.

### 2.2 Implement the function

The function should:

1. **Verify the key** (e.g. `x-heat-model-key` header) against a secret you set in Supabase (Dashboard → Edge Functions → `heat-model` → Secrets, or `HEAT_MODEL_KEY`).
2. **Parse the body**: e.g. `{ cityId?, barangays: [ { barangayId, lat, lng, temp_c? } ], cityTempC?, averageTempC? }`.
3. **Compute temperatures**: if `temp_c` per barangay is provided, use them (and optionally adjust); if only `cityTempC` is provided, broadcast to all barangays or apply a simple heuristic (e.g. by distance/elevation if you add that later).
4. **Optionally compute risks**: same PAGASA bands as `heatRiskModel.js`, or call an external ML API and map output to `risks[barangayId] = { level, label, score }`.
5. **Return** JSON in the shape the backend expects: `{ temperatures: { [id]: number }, min, max, averageTemp?, risks?: { [id]: { level, label, score, temp_c } }, updatedAt? }`.

See the example **`supabase/functions/heat-model/index.ts`** in this repo for a minimal implementation (heuristic only; no external ML).

### 2.3 Set the secret (API key)

In Supabase Dashboard: **Edge Functions** → select **heat-model** → **Secrets** → add `HEAT_MODEL_KEY` with a strong random value. Use the same value in your backend `.env` as `HEAT_MODEL_KEY` (do not commit it).

### 2.4 Deploy

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase functions deploy heat-model --no-verify-jwt
```

Use `--no-verify-jwt` if you want to rely only on your custom key (no Supabase JWT). Keep the key server-side only.

---

## 3. Backend configuration

Add to `.env` (and `.env.example` as commented template):

```env
# Optional: Supabase Edge Function for heat model (heuristic or ML).
# If set, heat routes can POST barangay list + raw temps and use the response.
# HEAT_MODEL_URL=https://<PROJECT_REF>.functions.supabase.co/heat-model
# HEAT_MODEL_KEY=<your-secret-key>
```

- **HEAT_MODEL_URL** – Full URL of the `heat-model` function (e.g. `https://<PROJECT_REF>.functions.supabase.co/heat-model`).
- **HEAT_MODEL_KEY** – Same value as the `HEAT_MODEL_KEY` secret in the Edge Function. Only used by the backend; never commit.

You can derive the URL from `SUPABASE_PROJECT_REF` if you prefer (same pattern as `heat-snapshot-writer`).

---

## 4. Request / response contract

### Request (POST from backend)

```json
{
  "cityId": "davao",
  "barangays": [
    { "barangayId": "1130700001", "lat": 7.05, "lng": 125.6, "temp_c": 31.2 },
    { "barangayId": "1130700002", "lat": 7.06, "lng": 125.61, "temp_c": 33.1 }
  ],
  "cityTempC": 30.5,
  "averageTempC": 30.5
}
```

- **barangays** – Required. Array of `{ barangayId, lat, lng, temp_c? }`. If `temp_c` is missing for some, the function can use `cityTempC` or `averageTempC` for those.
- **cityTempC** / **averageTempC** – Optional. Single city-level temp (e.g. from WeatherAPI) for broadcast or fallback.

### Response (200 OK)

```json
{
  "temperatures": { "1130700001": 31.2, "1130700002": 33.1 },
  "min": 26,
  "max": 39,
  "averageTemp": 30.5,
  "risks": {
    "1130700001": { "level": 2, "label": "Caution", "score": 0.35, "temp_c": 31.2 },
    "1130700002": { "level": 3, "label": "Extreme Caution", "score": 0.45, "temp_c": 33.1 }
  },
  "updatedAt": "2025-02-15T12:00:00.000Z"
}
```

- **temperatures** – Same as current API: barangay ID → temperature (°C).
- **min** / **max** – For legend and normalization.
- **averageTemp** – Optional.
- **risks** – Optional. If present, backend can use it for `/api/heat/:cityId/barangay-heat-risk` instead of calling `assessBarangayHeatRisk` locally.

---

## 5. Using the Edge Function from the backend

- In **`src/routes/heat.js`**, when building temps for `barangay-temperatures` or `barangay-heat-risk`:
  - If `HEAT_MODEL_URL` and `HEAT_MODEL_KEY` are set, POST the barangay list + raw temps (from Meteosource or WeatherAPI) to the Edge Function.
  - If the response is OK, use `response.temperatures`, `response.min`, `response.max`, and optionally `response.risks` for the heat-risk endpoint.
- If the Edge Function is not configured or the request fails, fall back to current behavior (local heuristic in `heatRiskModel.js`, temps from Meteosource/WeatherAPI as today).

This keeps the existing API contract; only the source of the "model" (Edge Function vs local) changes.

---

## 6. Adding real ML later

- **Option A – External ML API**: Inside the Edge Function, `fetch()` your own ML service (e.g. Python with scikit-learn or a small neural net) that takes the same inputs and returns temps/risks; map the response to the contract above.
- **Option B – Third-party inference**: Call Replicate, Hugging Face Inference, or similar from the Edge Function with the same input shape; map the model output to `temperatures` and `risks`.
- **Option C – Heuristic in Edge, ML elsewhere**: Keep the Edge Function as a heuristic for now; later add a separate "ML upgrade" that the Edge Function calls when you enable it (e.g. via a secret or feature flag).

In all cases, the **backend and API contract stay the same**; only the Edge Function implementation changes.
