DELETE FROM sample_tubes WHERE registration_id = '68d6ebdc-0986-4230-bdeb-ca422765c8e6';

INSERT INTO sample_tubes (sample_uid, registration_id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status)
VALUES (
  generate_sample_uid(),
  '68d6ebdc-0986-4230-bdeb-ca422765c8e6',
  'PLAIN',
  'RED',
  'SERUM',
  '',
  '["26b923ed-1c7e-4d11-8250-49d5437b6d91","a47bee52-8445-413d-adc6-90005edb44c1","8d48576c-daf3-4cdf-ba41-975597bd8bda"]'::jsonb,
  '["T3","T4","TSH"]'::jsonb,
  'pending'
);