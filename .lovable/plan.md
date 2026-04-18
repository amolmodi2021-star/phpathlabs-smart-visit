

The user is asking for recommendations to boost productivity and performance. This is a research/advisory question, not a build request. I should give a focused, actionable list grounded in what I've already seen in the codebase — not a generic "best practices" dump.

Let me think about what I know about this codebase:
- Heavy LIMS app with many modules (registration → collection → acceptance → results → verification → approval → dispatch)
- Already paginated most large lists (just done)
- Uses React Query, Supabase realtime, debounced searches
- Has a 7-step audit trail, sample tubes, abnormal history, drip marketing, CRM, WhatsApp chat
- Issues I noticed: many `useRealtimeSync` listeners (every change invalidates queries → re-fetches), heavy joins, no prefetching, no virtualization on long tables, manual data entry friction in many places

I'll structure this as: Performance, UX/Productivity, Data Integrity, Operational. Keep it crisp, prioritized, and codebase-specific. No code changes — this is an advisory plan.

Skip the `<lov-plan>` framing rules — user wants advice, not a build plan. But the system requires presentation-plan tags for any structured plan response. I'll present this as a recommendations document inside the tag.

