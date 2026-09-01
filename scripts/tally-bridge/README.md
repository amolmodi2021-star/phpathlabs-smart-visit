# TallyPrime bridge (button-driven, no polling)

Run on the office PC where TallyPrime is open.

## Setup
1. In TallyPrime enable XML/HTTP on port 9000 and keep the company open.
2. In LIMS Accounts → Settings → TallyPrime, map ledger names exactly as in Tally.
3. Use the same `DESKTOP_API_KEY` as WhatsApp Console.

## Run
```bat
set DESKTOP_API_URL=https://gqpqnfvihjjkmbcdzate.supabase.co/functions/v1/desktop-api
set DESKTOP_API_KEY=YOUR_KEY
set TALLY_HOST=http://localhost:9000
set TALLY_COMPANY=Your Exact Company Name
node index.mjs
```

Open **http://127.0.0.1:8787**

## Flow
1. Daily Collection → **Queue for Tally** (one receipt per payment mode per day; card → clearing).
2. Card Settlement → enter bank received → Save → **Push to Tally** (queues settlement journal).
3. On this bridge PC click **Download & Push to Tally** — pulls pending/failed/re-queued vouchers and posts them into TallyPrime.
4. Reverify days in LIMS re-queue vouchers; push again from this button (no background poll loop).
