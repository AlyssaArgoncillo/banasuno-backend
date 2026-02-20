# Deployment: Backend vs frontend

The BanasUno **frontend** and **backend** (this repo) are separate applications. Deploying the frontend to Vercel does **not** deploy or run this backend.

## What happens when you deploy to Vercel

- **Only the BanasUno frontend** (its repo) is built and served.
- The **backend API** (barangay temperatures, forecast, heat risk, facilities, etc.) is **not** on Vercel unless you deploy it there separately.

## To have live data in production

1. **Deploy this backend somewhere.** For a Node/Express app like this one, use one of:
   - **Railway / Render / Fly.io** – good for long-running Node apps.
   - **Vercel** – deploy this backend as a **second Vercel project** (or as serverless/API routes if you adapt it). You get a URL like `https://banasuno-api.vercel.app`.
   - Your own server or VPS.

2. **Point the frontend at that backend.**  
   In the Vercel project for the **frontend**:
   - Set environment variable: **`VITE_API_URL`** = your backend base URL  
     (e.g. `https://banasuno-api.vercel.app` or `https://your-backend.railway.app`).
   - Redeploy the frontend so it is built with that `VITE_API_URL`.

## Summary

| Setup | Backend runs? | Heat map / dashboard with real API? |
|-------|----------------|-------------------------------------|
| Deploy only frontend to Vercel | No | No (simulated/empty data) |
| Frontend on Vercel + backend deployed elsewhere, `VITE_API_URL` set | Yes (on the other host) | Yes |

---

## Deploying this backend on Vercel

This repo is set up for Vercel: the Express app is exported from `src/index.js` and `vercel.json` sets the framework to Express.

### Dashboard settings (New Project)

| Setting | Value |
|--------|--------|
| **Vercel Team** | Your team (e.g. Alyssa Nicole's projects) |
| **Project Name** | `banasuno-backend` (or any name) |
| **Application Preset** | **Express** (keep as detected) |
| **Root Directory** | `./` |
| **Build and Output Settings** | Leave defaults. |
| **Environment Variables** | Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CORS_ORIGIN (see below). |

### Required environment variables

- **SUPABASE_URL** (required) – Your Supabase project URL (Project Settings → API).
- **SUPABASE_SERVICE_ROLE_KEY** (required) – Your Supabase service_role key (do not commit). Same project as above.
- **CORS_ORIGIN** (recommended) – Your frontend URL (e.g. `https://your-frontend.vercel.app`).

**If the build fails with a "local DOM" or DOMException-related error:** Set the Node version to 18+. In the Vercel project go to **Settings → General → Node.js Version** and choose **18.x** or **20.x**, or add environment variable **NODE_VERSION** = `18` (or `20`). The repo’s `package.json` specifies `"engines": { "node": ">=18" }` so Vercel should use Node 18+ automatically; if not, set it explicitly.

Before the first deploy, run the migration SQL in **`supabase/migrations/20250220000000_app_store_tables.sql`** in the Supabase SQL Editor so the `health_facilities_davao` and `pipeline_report` tables exist. Then seed facilities with `npm run seed:facilities` locally (pointing at the same Supabase project) or via a one-off script.

Optional: **WEATHER_API_KEY** for heat/forecast; see `.env.example`.

### After deploy

Your API URL will be like `https://banasuno-backend-xxx.vercel.app`. Set that as **VITE_API_URL** in your frontend project.

---

**Bottom line:** This backend does not run automatically when you deploy the frontend to Vercel. Deploy and host it separately, then set **`VITE_API_URL`** in the frontend’s Vercel environment.
