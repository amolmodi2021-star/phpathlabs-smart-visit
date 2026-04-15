

# Sync Demographics Across All Records for Same UMR

## Problem
When a patient is selected from the dropdown with an existing UMR number and the user changes demographics (name, title, gender, DOB, address), only the new registration and `patient_master` get updated. Previous `patient_registrations` with the same UMR still show the old name/details, creating inconsistency — same UMR appears with two different names.

## Root Cause
In `PatientRegistration.tsx` lines 447-464, the save logic correctly upserts `patient_master`, but does **not** update existing `patient_registrations` rows that share the same `umr_number`.

## Solution
In the `saveMutation` function, after upserting `patient_master` (line ~464) and before `return reg`, add a bulk update to synchronize demographics across all `patient_registrations` with the same UMR:

```typescript
// Update demographics on all previous registrations with same UMR
if (finalUmr) {
  const demoUpdates: any = {
    patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
    title,
    gender,
    dob: dob || null,
    email: email || null,
    address: visitType === "pickup_point" ? (selectedPickup?.address || "") : address.toUpperCase(),
    doctor_name: (doctorName || "SELF").toUpperCase(),
    mobile_number: cleanMobile,
  };
  await supabase
    .from("patient_registrations")
    .update(demoUpdates)
    .eq("umr_number", finalUmr)
    .neq("id", reg.id);
}
```

This updates name, title, gender, DOB, email, address, doctor, and mobile for all prior registrations sharing the same UMR — excluding the just-created record. Non-demographic fields (tests, amounts, status) are untouched.

### File changed
- `src/components/lims/PatientRegistration.tsx` — ~10 lines added after the `patient_master` upsert block

### No database changes needed

