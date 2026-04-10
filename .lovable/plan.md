

# Fix: Collected Tab Not Updating After Partial Collection

## Problem
When collecting a sample (partial collection), the "Collected" tab doesn't update in real time. The user must manually refresh to see the change.

## Root Cause
The `partialCollectMutation` (line 354-356) invalidates `sample_collection_patients` and `patient_registrations` on success, but **does not** invalidate `sample_collected_patients` — the query key used by the Collected tab.

## Fix — `src/components/lims/SampleCollection.tsx`

Add the missing query invalidation in the `partialCollectMutation.onSuccess` callback:

```typescript
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
  qc.invalidateQueries({ queryKey: ["sample_collected_patients"] });  // <-- add this line
  qc.invalidateQueries({ queryKey: ["patient_registrations"] });
},
```

**One line addition. One file.**

