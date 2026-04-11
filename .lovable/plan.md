

# Plan: Add Pending Counters for ABC Cards & Abnormal History

## What
Add two counters at the top of the Automated tab (below the 24h usage card) showing:
1. **Pending ABC Cards** — count of CRM contact records locked to ABC card filters that haven't been sent yet in the current cycle
2. **Pending Abnormal History** — count of CRM contact records locked to Abnormal History filters that haven't been sent yet in the current cycle

## How

### File: `src/components/marketing/AutomatedMarketing.tsx`

**1. Add a new query hook for pending counts**

Create a `useQuery` that runs the same logic as the preview engine but only computes counts:
- Fetch all CRM contacts, drip campaign logs, drip mobile cycles, enabled filters, and abnormal test PKs
- For each mobile, determine which priority level it's locked to
- For ABC filters: count contacts with UMR numbers that haven't been sent yet (in current cycle) where the mobile is locked to that ABC filter's priority
- For Abnormal filters: count contacts with abnormal test data that haven't been sent yet where the mobile is locked to that Abnormal filter's priority
- Return `{ pendingAbc: number, pendingAbnormal: number }`

**2. Add counter UI**

Insert a row of two small stat cards between the 24h usage card and the Global Settings card:
- Card 1: "Pending ABC Cards" with the count and a badge icon
- Card 2: "Pending Abnormal History" with the count and a badge icon
- Both show a loading skeleton while computing

## Single file modified
- `src/components/marketing/AutomatedMarketing.tsx`

