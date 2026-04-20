
User wants ability to assign MULTIPLE sample tubes to a single test (different types). Currently `tests` table has single `sample_tube`, `tube_color`, `sample_type` columns.

Need to:
1. New junction table `test_sample_tubes` (test_id, tube_value, sample_type, tube_color, display_order)
2. UI in TestManagement Add/Edit dialog: replace single dropdown with a list + "Add Tube" button
3. Update sampleTubeGrouping.ts to fan out per-test into multiple tubes
4. Keep backward compat: existing `tests.sample_tube` still works as fallback

Keep plan tight.
