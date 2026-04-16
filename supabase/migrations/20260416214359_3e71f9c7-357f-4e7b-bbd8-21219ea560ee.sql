-- Allow same machine_code to map to multiple internal parameter codes
ALTER TABLE public.lims_code_mapping
  DROP CONSTRAINT IF EXISTS lims_code_mapping_machine_code_machine_id_key;

-- Prevent exact duplicate rows (same machine_code + machine_id + mapped_param_code + mapped_test_code)
CREATE UNIQUE INDEX IF NOT EXISTS lims_code_mapping_unique_combo
  ON public.lims_code_mapping (
    machine_code,
    COALESCE(machine_id, ''),
    COALESCE(mapped_param_code, ''),
    COALESCE(mapped_test_code, '')
  );