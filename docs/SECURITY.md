# Security checklist

Quick review of secrets and safe defaults in this repo.

## What we do

- **Secrets from env only** – No API keys or Supabase keys are hardcoded. All are read from `process.env` (via `.env`).
- **`.env` is gitignored** – So local secrets are not committed. Use `.env.example` as a template (no real values).
- **Supabase** – Backend uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the server; never exposed to the frontend. Docs say not to commit the service_role key.
- **Health endpoint** – Returns only status strings (`connected` / `not_configured` / `error`) and a generic `supabase_error` message (e.g. from Postgres); no keys or stack traces.
- **Supabase CLI** – `supabase/.temp/` (project ref, pooler URL, etc.) is in `.gitignore` so link-generated files are not committed.

## What you should do

1. **Never commit** `.env`, `.env.local`, or any file containing real keys/tokens.
2. **Rotate keys** if they were ever committed or shared (e.g. Supabase Dashboard → Project Settings → API → regenerate service_role; create new Access Tokens under Account).
3. **CLI token** – Use a personal access token (`sbp_...`) from Account → Access Tokens only for `supabase link`; do not put it in `.env` or commit it.
4. **If `supabase/.temp/` was committed before** – Remove from Git history and stop tracking:  
   `git rm -r --cached supabase/.temp 2>nul; git commit -m "Stop tracking supabase/.temp"` (then ensure `supabase/.temp/` is in `.gitignore`).

## Optional hardening

- **CORS** – In production set `CORS_ORIGIN` in `.env` to your frontend origin (e.g. `https://your-app.vercel.app`). If unset, the server sends `Access-Control-Allow-Origin: *` (fine for local dev).
- Use a **secrets manager** or CI env vars for production instead of a `.env` file on the server.
