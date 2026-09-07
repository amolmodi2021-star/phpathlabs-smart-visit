import { getFontEmbedCSS } from "html-to-image";

/** Same stack as on-screen reports (`index.css` / Tailwind `font-sans`). Quotes matter: html-to-image SVG clones otherwise parse `IBM Plex Sans` as three families. */
export const REPORT_CAPTURE_FONT =
  '"IBM Plex Sans", "Noto Sans", "Segoe UI", Arial, Helvetica, sans-serif';

const LOCAL_IBM_PLEX_WEIGHTS = [300, 400, 500, 600, 700] as const;

let cachedEmbedCSS: string | null = null;
let embedInflight: Promise<string> | null = null;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function embedLocalIbmPlexSans(): Promise<string> {
  if (typeof fetch !== "function") return "";
  const faces = await Promise.all(
    LOCAL_IBM_PLEX_WEIGHTS.map(async (weight) => {
      const href = `/fonts/ibm-plex-sans-latin-${weight}-normal.woff2`;
      const res = await fetch(href);
      if (!res.ok) throw new Error(`font ${href} ${res.status}`);
      const b64 = arrayBufferToBase64(await res.arrayBuffer());
      return (
        `@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
      );
    }),
  );
  return faces.join("\n");
}

/**
 * Embed IBM Plex (local woff2) plus any other document webfonts, once per session.
 * html-to-image clones into an SVG foreignObject — painted DOM pixels are not reused,
 * so skipFonts leaves CREATININE / Enzymatic on a fallback face with different metrics.
 */
export async function getCachedReportFontEmbedCSS(node: HTMLElement): Promise<string> {
  if (cachedEmbedCSS != null) return cachedEmbedCSS;
  if (embedInflight) return embedInflight;
  embedInflight = (async () => {
    let fromLib = "";
    let local = "";
    try {
      fromLib = await getFontEmbedCSS(node);
    } catch {
      fromLib = "";
    }
    try {
      local = await embedLocalIbmPlexSans();
    } catch {
      local = "";
    }
    cachedEmbedCSS = [local, fromLib].filter(Boolean).join("\n");
    return cachedEmbedCSS;
  })();
  try {
    return await embedInflight;
  } finally {
    embedInflight = null;
  }
}

export function resetReportFontEmbedCache(): void {
  cachedEmbedCSS = null;
  embedInflight = null;
}

export function reportCaptureStyle(extra: Record<string, string> = {}): Record<string, string> {
  return {
    fontFamily: REPORT_CAPTURE_FONT,
    ...extra,
  };
}
