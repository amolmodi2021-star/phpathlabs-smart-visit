# TallyPrime bridge (run on the office PC where Tally is open)

## Setup
1. In TallyPrime enable XML/HTTP on port 9000 and keep the company open.
2. In LIMS Accounts - Settings - TallyPrime, map ledger names exactly as in Tally.
3. Use the same DESKTOP_API_KEY as WhatsApp Console.

## Run
set DESKTOP_API_URL=https://gqpqnfvihjjkmbcdzate.supabase.co/functions/v1/desktop-api
set DESKTOP_API_KEY=YOUR_KEY
set TALLY_HOST=http://localhost:9000
set TALLY_COMPANY=Your Exact Company Name
node index.mjs

## Flow
1. Daily Collection - Push to Tally (one receipt per payment mode per day).
2. Credit card posts to Credit Card Clearing (gross).
3. Card Settlement - enter bank received amount - Save - Push to Tally.
4. This bridge posts queued vouchers into TallyPrime.
