# PHPL Report PDF (Chromium)

Prints LIMS View Report HTML to PDF with Playwright Chromium so text stays vector and layout/colors match on-screen.

## Local

```bash
cd services/report-pdf
npm install
npx playwright install chromium
set REPORT_PDF_SERVICE_KEY=some-long-secret
npm start
```

## Supabase secrets (PHPL)

```bash
npx supabase secrets set --project-ref gqpqnfvihjjkmbcdzate ^
  REPORT_PDF_SERVICE_URL=https://your-host:3791 ^
  REPORT_PDF_SERVICE_KEY=some-long-secret
```

Then in LIMS → Report Layout Settings → switch **Report PDF engine** to **Chromium print**.
To revert instantly, switch back to **Screen JPEG (current)**.