

# Plan: Display Name Priority & Single Parameter Name Override

## What Changes

### 1. Use `display_name` (with fallback to `test_name`) for test/profile headers

In `transformBlocksToGrouped` (LimsReportView.tsx, line 655), the profile key currently uses `block.testName` which is always the raw `test_name`. Change the test block construction (line 291) to prefer `display_name` over `test_name`:

```
testName: testInfo?.display_name || params[0]?.test_name || testInfo?.test_name || "Unknown Test"
```

Also update `buildProfileMetaMap` (line 714) since it uses `block.testName` as the key — this will automatically use the display name since the block already carries it.

### 2. Single Parameter Test: replace parameter name with display_name/test_name

When `is_single_parameter` is true, the test has exactly one parameter row. Instead of showing the parameter's own name, show `display_name` (priority) or `test_name`.

- Add `is_single_parameter` to the tests fetch query (line 139) and to the `TestBlock` interface
- In `transformBlocksToGrouped`, when `testsMap[block.testId]?.is_single_parameter` is true, override `parameter_name` in the single result entry with `block.testName` (which already prefers display_name per change #1)

### Files Modified
- `src/pages/LimsReportView.tsx` — test block construction + transform function (~5 lines changed)

