
The error: `Could not find a relationship between 'combo_profiles' and 'billing_profiles' in the schema cache`.

In `src/lib/combos.ts`, `getComboProfiles` does:
```
.select("id, combo_id, profile_id, display_order, billing_profiles(profile_name, profile_code, price)")
```

This embedded join requires a FK from `combo_profiles.profile_id` → `billing_profiles.id`. The migration likely created `combo_profiles.profile_id` without that FK (the plan said "uuid NOT NULL" — no FK).

Same risk for `combo_tests.test_id` → `tests.id`. Let me check `getComboTests` — it embeds `tests(...)` similarly. User hasn't reported that error but probably hits it after profiles works.

Fix: add the missing FKs via migration, then PostgREST schema cache resolves the embed.

## Plan

Add foreign keys so PostgREST embedded selects work:

1. **Migration**:
   - `ALTER TABLE public.combo_profiles ADD CONSTRAINT combo_profiles_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.billing_profiles(id) ON DELETE CASCADE;`
   - `ALTER TABLE public.combo_tests ADD CONSTRAINT combo_tests_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;`
   - (Cleanup any orphan rows first if needed — combos table is brand new so should be empty.)

2. No code changes needed; `src/lib/combos.ts` queries will start working once the FKs exist and PostgREST refreshes its schema cache (automatic).

## Files
- **MIGRATION** new SQL adding the two FK constraints.

