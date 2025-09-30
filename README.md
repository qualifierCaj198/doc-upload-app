# Document Upload App (Node/Express + Postgres)

Upload form + admin panel with TLD CRM (Ingress lead + document upload) and Connex AI trigger.

## Setup
```bash
cp .env.example .env   # fill in values
npm install            # creates package-lock.json
npm run db:init
npm start
```

## Important
- MAX file size is 10MB (set via `.env`)
- The upload page includes ACA income verification instructions + certification checkbox
- Place your Income Letter PDF at `src/public/income-letter.pdf` (a placeholder is included—replace it)

## TLD
- Uses `PUT /api/ingress/leads` to create/update (headers: `tld-api-id`, `tld-api-key`)
- Uploads files with `POST /api/ingress/documents/upload/lead/{lead_id}`

## Deploy to Vultr
- Use NGINX reverse proxy from `deploy/nginx.conf` and PM2 to run the app
- CI/CD via `.github/workflows/deploy.yml`
