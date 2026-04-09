
# Plan: Build Verification → Doctor Approval → Dispatch Pipeline

## Overview
Complete the LIMS result lifecycle: Results Entry → Result Verification (editable) → Doctor Approval → Dispatch. Each section mirrors the Results Entry UI with full editing capability.

## Status Flow
```
entered → verified → approved → dispatched
                  ↘ repeat_collection (doctor sends back to Sample Collection)
         ↗ entered (doctor sends back for re-verification)
```

## Step 1: Enhance Result Verification Tab
- Replace current read-only verification view with **full editable Results Entry UI** (same table layout with Code, Parameter, Prev1, Prev2, Result, Unit, Ref Range, Flag, Status columns)
- All result values are editable (same input fields, dropdowns for descriptive/qualitative)
- Show patient cards with expandable test sections (same as Results Entry)
- "Verify & Send to Doctor" button per test → changes status from `entered` to `verified`
- "Send Back" option → changes status back to allow re-entry

## Step 2: Build Doctor Approval Tab
- New tab in LIMS: "Doctor Approval" (between Result Verification and Completed Home Visits)
- Same editable UI as Result Verification
- Filters records with status = `verified`
- Actions per test:
  - **Approve** → status changes to `approved`
  - **Send Back for Verification** → status changes back to `entered`
  - **Request Repeat Collection** → status changes to `repeat_collection` (sends back to Sample Collection queue)
- Doctor can edit result values, flags, units, reference ranges before approving

## Step 3: Build Dispatch Tab
- New tab in LIMS: "Dispatch" (after Doctor Approval)
- Shows records with status = `approved`
- Patient cards showing approved tests with results summary
- **Dispatch via WhatsApp** button → opens WhatsApp with patient mobile number
- **Mark as Dispatched** → status changes to `dispatched`
- Dispatch date/time recorded

## Step 4: Update LIMS Tabs
- Update Lims.tsx tab order: Register → Registered Patients → Sample Collection → Sample Acceptance → Results → Result Verification → Doctor Approval → Dispatch → Completed Home Visits → Pickup Points → Channels

## New Components
1. `src/components/lims/DoctorApproval.tsx` - Doctor approval interface
2. `src/components/lims/Dispatch.tsx` - Dispatch interface

## Modified Components
1. `src/components/lims/ResultVerification.tsx` - Replace with full editable UI matching Results Entry
2. `src/pages/Lims.tsx` - Add new tabs
