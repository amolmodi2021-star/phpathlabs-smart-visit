/**
 * WhatsApp Console outbox helpers: sequential invoice enqueue (bound tokens)
 * and same-phone delivery serialization so multi-patient home-visit invoices
 * stay in registration order without an artificial delay between captures.
 */

export type InvoiceQueueToken = {
  invoiceNumber: string;
  nonce: number;
};

export type OutboxPhoneJob = {
  phone: string;
};

/** True when a parent-driven queue request matches the invoice currently on screen and ready. */
export function shouldFireBoundInvoiceQueue(args: {
  token: InvoiceQueueToken | null | undefined;
  lastNonce: number;
  currentInvoiceNumber: string | null | undefined;
  ready: boolean;
}): boolean {
  const invoice = String(args.currentInvoiceNumber || "").trim();
  const tokenInvoice = String(args.token?.invoiceNumber || "").trim();
  const nonce = Number(args.token?.nonce || 0);
  if (!args.ready || !invoice || !tokenInvoice || nonce <= 0) return false;
  if (tokenInvoice !== invoice) return false;
  if (nonce === args.lastNonce) return false;
  return true;
}

/** Next nonce-scoped token for an invoice. Never reuse nonce 0 (means "idle"). */
export function nextInvoiceQueueToken(
  invoiceNumber: string,
  previousNonce: number,
): InvoiceQueueToken {
  const invoice = String(invoiceNumber || "").trim();
  return {
    invoiceNumber: invoice,
    nonce: Math.max(1, Math.floor(Number(previousNonce) || 0) + 1),
  };
}

/**
 * Pick pending outbox jobs oldest-first, at most one per phone, and skip phones
 * that already have a claimed (in-flight) job. Keeps family invoices on the
 * same WhatsApp number in created_at order without waiting 3s between enqueue.
 */
export function pickOutboxJobsSerializingPhone<T extends OutboxPhoneJob>(
  pending: T[],
  alreadyClaimedPhones: Iterable<string>,
  limit: number,
): T[] {
  const cap = Math.min(Math.max(Math.floor(Number(limit) || 0), 0), pending.length);
  if (cap <= 0) return [];
  const busy = new Set(
    [...alreadyClaimedPhones].map((p) => normalizeOutboxPhone(p)).filter(Boolean),
  );
  const picked: T[] = [];
  for (const row of pending) {
    if (picked.length >= cap) break;
    const phone = normalizeOutboxPhone(row.phone);
    if (!phone || busy.has(phone)) continue;
    picked.push(row);
    busy.add(phone);
  }
  return picked;
}

export function normalizeOutboxPhone(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}
