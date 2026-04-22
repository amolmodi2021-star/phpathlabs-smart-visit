

# Cloudinary integration — ready to wire up

## Important security note first

You shared your **API Secret** (`WKcMJkU4TcVitiDbX1mKizqCyOM`) and full **CLOUDINARY_URL** in chat. **Please rotate these immediately** in Cloudinary:

1. Go to **Settings → Access Keys** (or **Security** tab) in your Cloudinary console
2. Click **Generate New API Secret** (or revoke the current key pair and create new credentials)
3. The new secret stays **only in your Cloudinary dashboard** — do NOT paste it in chat again

For the browser-side upload flow we're building, **only two values are needed, and both are public-safe**:

- **Cloud name:** `dd7qn3t3d` ✅
- **Upload preset:** `phpathlabs_cards` ✅ (unsigned, scoped to `loyalty-cards` folder, confirmed in your earlier screenshot)

The API key and API secret are **NOT used** by this integration. Browser uploads use the unsigned preset, which is the secure way to do this. Your secret only matters if we later add a server-side cleanup edge function — and even then it'd live as a Lovable Cloud secret, not in code.

---

## What I'll change (one pass)

### 1. New file `src/lib/cardStorageCloudinary.ts` (~50 lines)

Single helper `uploadJpegToCloudinary(blob)`:

```typescript
const CLOUD_NAME = "dd7qn3t3d";
const UPLOAD_PRESET = "phpathlabs_cards";

export async function uploadJpegToCloudinary(blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob);
  fd.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: fd }
  );
  if (!res.ok) throw new Error(`cloudinary_${res.status}`);
  const json = await res.json();
  return json.secure_url as string;
}
```

Wrapped in the same 3-attempt retry helper as today (250 ms / 750 ms backoff), with classified failure reasons: `cloudinary_5xx`, `cloudinary_4xx`, `cloudinary_network`. Cloud name + preset are hardcoded since both are public values — keeps setup zero-friction (no env-var wiring needed).

### 2. Swap upload call in `src/lib/cardRenderer.ts`

Inside `generateAndUploadCardEx`, replace the `uploadWithRetry(...) + supabase.storage.getPublicUrl(...)` block with:

```typescript
const blob = await exportCanvasAsCompressedJpeg(canvas);
const url = await uploadJpegToCloudinaryWithRetry(blob);
return { url };
```

Existing JPEG compression (max 800 px, quality 0.72) is unchanged. Existing `{ url, reason? }` return shape is preserved so `AutomatedMarketing.tsx` doesn't change.

### 3. Same swap in `src/lib/dripCardSenders.ts`

Inside `generateAbnormalCardForDripEx`, identical swap. Quality stays at 0.78 for abnormal cards.

### 4. Extend the failure-reason union in both files

Add `"cloudinary_5xx" | "cloudinary_4xx" | "cloudinary_network"` to `CardFailureReason`. The diagnostic log in `AutomatedMarketing.tsx` already passes the reason through, so failures will surface with their real cause.

### 5. Pause the now-redundant Supabase cron job

`cleanup-card-images-midnight` cron → I'll pause it (not delete, so it's easy to re-enable if you ever revert). Cards never enter the Supabase `loyalty-cards` bucket anymore, so there's nothing to clean up there.

### 6. Nothing else changes

`whatsapp-proxy` edge function, `message_send_log`, `drip_action_log`, `crm_contacts`, ABC/Abnormal/Promotion campaign logic, Pause/Stop/Trial/Retry, worker-pool concurrency, the `loyalty-cards` Supabase bucket itself (left empty) — all untouched.

---

## After-deploy verification (we'll do together)

1. Send **5 ABC cards** to a test number → cards arrive on WhatsApp; URLs in `message_send_log` start with `https://res.cloudinary.com/dd7qn3t3d/...`
2. Open Cloudinary **Media Library → loyalty-cards/** → see the 5 uploads, ~35 KB each
3. Open Lovable Cloud `loyalty-cards` bucket → **stays at 0 bytes**
4. Run a **100-card campaign at concurrency=10, delay=0** → no `render_failed`, no Cloud egress spike
5. Cloudinary dashboard **Usage** tab → bandwidth = (cards × ~35 KB × 1 fetch). Free ceiling 25 GB/month vs your ~0.25 GB/month actual

---

## Expected outcome

- Daily Lovable Cloud usage drops from ~$4–5 → **near $0**
- Send speed, image quality, campaign behavior: identical
- Filename collisions impossible (Cloudinary auto-assigns unique IDs)
- Reversible in 5 minutes if Cloudinary ever has issues

---

## Files that will change

- `src/lib/cardStorageCloudinary.ts` — new
- `src/lib/cardRenderer.ts` — swap upload call, extend failure-reason union
- `src/lib/dripCardSenders.ts` — same swap
- (Pause cron) `cleanup-card-images-midnight` — disable schedule

## Action items for you

1. **Rotate the Cloudinary API secret now** (it was shared in chat — assume compromised)
2. **Approve this plan** to start the swap
3. **Do not** share the new secret with me — it's not needed for this flow

