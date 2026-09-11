/**
 * Cloudflare R2 (S3-compatible) helpers for WhatsApp report PDFs.
 * Secrets (edge env):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
 */
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

export function loadR2Config(): R2Config | null {
  const accountId = (Deno.env.get("R2_ACCOUNT_ID") || "").trim();
  const accessKeyId = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim();
  const secretAccessKey = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (Deno.env.get("R2_BUCKET_NAME") || "").trim();
  const publicBaseUrl = (Deno.env.get("R2_PUBLIC_BASE_URL") || "").trim().replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function r2ObjectUrl(cfg: R2Config, key: string): string {
  const enc = key
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${enc}`;
}

export function r2PublicUrl(cfg: R2Config, key: string): string {
  const enc = key
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `${cfg.publicBaseUrl}/${enc}`;
}

function awsClient(cfg: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

/** Presigned PUT so the browser uploads bytes directly to R2 (no Edge body limit). */
export async function presignR2Put(
  cfg: R2Config,
  key: string,
  contentType: string,
  expiresSeconds = 900,
): Promise<{ uploadUrl: string; publicUrl: string; key: string; expiresIn: number }> {
  const url = new URL(r2ObjectUrl(cfg, key));
  url.searchParams.set("X-Amz-Expires", String(Math.max(60, Math.min(expiresSeconds, 3600))));
  const client = awsClient(cfg);
  const signed = await client.sign(
    new Request(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": contentType || "application/pdf" },
    }),
    { aws: { signQuery: true } },
  );
  return {
    uploadUrl: signed.url,
    publicUrl: r2PublicUrl(cfg, key),
    key,
    expiresIn: expiresSeconds,
  };
}

export async function deleteR2Object(cfg: R2Config, key: string): Promise<boolean> {
  const clean = String(key || "").replace(/^\/+/, "").trim();
  if (!clean || clean.includes("..")) return false;
  const client = awsClient(cfg);
  const res = await client.fetch(r2ObjectUrl(cfg, clean), { method: "DELETE" });
  // 404 = already gone
  return res.ok || res.status === 404;
}

/** Safe object-key segment (no spaces). Used only for R2 paths, not WhatsApp display names. */
export function sanitizeReportKeyPart(raw: string, fallback = "report"): string {
  const s = String(raw || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

/** WhatsApp / download filename — keep spaces (e.g. "TITLE NAME 2609110001.pdf"). */
export function sanitizeReportDisplayFilename(raw: string, fallback = "report.pdf"): string {
  let base = String(raw || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) base = fallback;
  base = base.replace(/\.pdf$/i, "").trim() || fallback.replace(/\.pdf$/i, "");
  return `${base.slice(0, 120)}.pdf`;
}