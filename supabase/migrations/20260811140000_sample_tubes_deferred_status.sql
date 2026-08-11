-- Deferred tubes: collect on a later visit; barcode (invoice+suffix) unchanged.
-- sample_tubes.status has no CHECK constraint; deferred is an additive status value.
COMMENT ON COLUMN public.sample_tubes.status IS 'pending | deferred | collected | accepted';
