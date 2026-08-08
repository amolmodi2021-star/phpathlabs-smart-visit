# PathLabs Connect

Project Name

PH PathLabs Estimate

App Type

Responsive Web App + Progressive Web App (PWA)
Installable on mobile via Chrome → Add to Home Screen
Works like a mobile app and desktop web app

Authentication (Fixed, One-Time Login)

Fixed credentials only

User ID: PHPATHLABS

Password: PHPL6699

Login required only once

Persist login across browser sessions and mobile PWA

Do not ask for login again unless manually logged out

No signup, no OTP, no multiple users

Application Modules / Tabs

1️⃣ CREATE ESTIMATE

Input Fields

Patient Name (Optional)

WhatsApp Mobile Number (Mandatory, numeric validation)

Select Tests (Multi-select from Test Management)

Individual Test Discount (% or ₹)

Allowed only if Discount Applicable = Yes

Global Discount (% or ₹)

Home Visit Charges (Optional)

Discount Rules (Mandatory)

Home Visit Charges are never discounted

Individual discount allowed only for eligible tests

Global discount applies only to:

Tests where discount is allowed

Tests where individual discount is NOT applied

If some tests have individual discount:

Global discount applies only to remaining eligible tests

Tests with Discount Applicable = No never receive discount

Double discount on same test is strictly not allowed

Auto Calculations

Total Test Amount

Total Discount Amount

Final Amount = (Tests – Discount) + Home Visit Charges

WhatsApp Share

Share estimate as TEXT via WhatsApp

Save estimate data to database with timestamp

Mark estimate status as “Estimate Created”

WhatsApp Estimate Message Format

PH PathLabs - Estimate
ddd - dd-mm-yyyy

Test Details:
• Test Name – ₹Price

Amount: ₹XXXX
Discount Amount: (₹XXX)
Home Visit Charges: ₹XXX
Final Amount: ₹XXXX

Fasting required for: Test1, Test2
8 to 10 hours of fasting is required.

If home visit charge is not included:
Home visit charges are not included and will be charged extra depending on your area of visit.

LabLine : 6356 55 66 99
PH PathLabs - Vesu

2️⃣ ESTIMATE DASHBOARD

Display Rules (IMPORTANT)

Show ONLY estimates where Home Visit is NOT booked

Once a home visit is booked for an estimate:

That estimate must be removed / hidden from Estimate Dashboard

The record must appear only in Home Visit module

This avoids duplicate visibility and confusion

Columns

Date

Patient Name

WhatsApp Number

Tests Selected

Total Amount

Discount Amount

Home Visit Charges

Final Amount

Features

Open estimate → Book Home Visit

Download visible estimates in Excel

Select & Delete estimates

Delete All (only estimates without home visit)

3️⃣ BOOK HOME VISIT (FROM ESTIMATE)

Input Fields

Visit Date

Visit Time (manual)

Address (multi-line)

Assign Phlebotomist (Active only)

Logic

On successful booking:

Create Home Visit record

Link it to Estimate ID

Mark estimate status as “Home Visit Booked”

Remove estimate from Estimate Dashboard automatically

WhatsApp Visit Confirmation Message

PH PathLabs - Visit Confirmation

Visit Date & Time:
dd-mm-yyyy | hh:mm

Address:
<full address>

Test Details:
• Test Name – ₹Price

Amount: ₹XXXX
Discount Amount: (₹XXX)
Home Visit Charges: ₹XXX
Final Amount: ₹XXXX

Fasting required for: Test1, Test2
8 to 10 hours of fasting is required.

Thank you for choosing us.
LabLine : 6356 55 66 99
PH PathLabs - Vesu

4️⃣ HOME VISIT MODULE

Display (Sorted by Latest Visit Date & Time First)

Visit Date & Time

Patient Name

Address

Assigned Phlebotomist

Home Visit Charges

Call Button (WhatsApp number)

Status:

Pending

Completed

Cancelled

Rules

If status = Cancelled:

Cancellation reason is mandatory (paragraph text)

Changing visit status does NOT move record back to Estimate Dashboard

Actions

Assign / Change Phlebotomist

Update status

Download all home visits in Excel

5️⃣ PHLEBOTOMIST MANAGEMENT MODULE

Fields

Phlebotomist Name (Mandatory)

Mobile Number (Mandatory)

Alternate Mobile (Optional)

Area / Zone (Optional)

Status (Active / Inactive)

Notes (Optional)

Rules

Only Active phlebotomists appear in Home Visit assignment

Inactive phlebotomists stay linked to old visits (history preserved)

Features

Add

Edit

Delete

Search

6️⃣ TEST MANAGEMENT MODULE

Excel Upload

Provide downloadable Excel template with:

Test Name

Price

Fasting Required (Yes/No)

Discount Applicable (Yes/No)

Description

Features

Add / Edit / Delete test

Search test

Export tests to Excel

7️⃣ MESSAGE TEMPLATE MODULE

Editable fields:

Estimate Header

Visit Confirmation Header

Fasting Instructions

Home Visit Disclaimer Line

Footer Text

Changes should reflect instantly in WhatsApp messages.

Database Requirements (Lovable Cloud)

Tables

tests

estimates (include status: Estimate Created / Home Visit Booked)

estimate_tests

home_visits

phlebotomists

message_templates

Rules

Use foreign keys

Maintain timestamps

Filter Estimate Dashboard by status = Estimate Created

Move records logically (not delete) when home visit is booked

UI / UX Requirements

Mobile-first

Simple medical UI

PWA support

Fast load

Clean tables

Search & Excel export everywhere

Final Goal

A confusion-free PH PathLabs Estimate & Home Visit Management System that:

Separates estimates and booked visits clearly

Prevents duplicate records

Tracks full home visit lifecycle

Works reliably on mobile & desktop

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://phpathlabs-smart-visit.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d5e0f5a9-453a-413d-8f4e-55d9c12b9e6c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
