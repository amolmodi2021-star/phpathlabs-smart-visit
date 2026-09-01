-- Credit card posts like other modes (exact LIMS amount); no clearing flag.
UPDATE public.accounts_tally_mode_map
SET uses_clearing = false,
    updated_at = now()
WHERE mode_key = 'credit_card';
