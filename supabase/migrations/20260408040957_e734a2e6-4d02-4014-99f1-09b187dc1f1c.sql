
ALTER TABLE public.test_parameters
  ADD COLUMN is_subheader boolean NOT NULL DEFAULT false,
  ADD COLUMN subheader_text text NULL;
