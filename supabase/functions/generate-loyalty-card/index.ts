import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { Resvg } from "npm:resvg-wasm@2.4.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// No WASM init needed for npm package

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { backgroundUrl, placeholders, patientData, jobId } = await req.json();

    if (!backgroundUrl || !placeholders || !patientData) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the background image
    const bgResponse = await fetch(backgroundUrl);
    if (!bgResponse.ok) throw new Error(`Failed to fetch background: ${bgResponse.status}`);
    const bgBuffer = await bgResponse.arrayBuffer();
    const bgBytes = new Uint8Array(bgBuffer);
    // Convert to base64 in chunks to avoid stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bgBytes.length; i += chunkSize) {
      const chunk = bgBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const bgBase64 = btoa(binary);
    const bgMime = bgResponse.headers.get("content-type") || "image/jpeg";

    // Get image dimensions from binary header
    const dims = getImageDimensions(bgBytes);
    const width = dims.width;
    const height = dims.height;

    // Fetch barcode font if needed
    let barcodeFontBase64 = "";
    let needsBarcodeFont = false;
    for (const p of placeholders as any[]) {
      if (p.field === "Barcode") { needsBarcodeFont = true; break; }
    }

    if (needsBarcodeFont) {
      try {
        // Fetch the actual font file from Google Fonts
        const cssRes = await fetch("https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap", {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        const cssText = await cssRes.text();
        const fontUrlMatch = cssText.match(/url\((https:\/\/[^)]+\.woff2?)\)/);
        if (fontUrlMatch) {
          const fontRes = await fetch(fontUrlMatch[1]);
          const fontBuf = await fontRes.arrayBuffer();
          const fontBytes = new Uint8Array(fontBuf);
          let fontBin = "";
          for (let i = 0; i < fontBytes.length; i += chunkSize) {
            const chunk = fontBytes.subarray(i, i + chunkSize);
            fontBin += String.fromCharCode(...chunk);
          }
          barcodeFontBase64 = btoa(fontBin);
        }
      } catch (e) {
        console.warn("Failed to fetch barcode font:", e);
      }
    }

    // Build SVG with background image and text overlays
    let svgTexts = "";
    for (const p of placeholders as any[]) {
      const isBarcode = p.field === "Barcode";
      const text = isBarcode ? (patientData["Mobile"] || "") : (patientData[p.field] || "");
      if (!text) continue;
      const x = (p.x / 100) * width;
      const y = (p.y / 100) * height;
      const fontSize = p.fontSize || 32;
      const fontColor = p.fontColor || "#000000";
      const bold = p.bold ? "bold" : "normal";
      const fontFamily = isBarcode ? "'Libre Barcode 128'" : "Arial, Helvetica, sans-serif";
      svgTexts += `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fontColor}" font-weight="${bold}" font-family="${fontFamily}" dominant-baseline="hanging">${escapeXml(text)}</text>`;
    }

    // Embed barcode font directly as base64 @font-face for resvg compatibility
    const fontDefs = needsBarcodeFont && barcodeFontBase64
      ? `<defs><style>@font-face { font-family: 'Libre Barcode 128'; src: url('data:font/woff2;base64,${barcodeFontBase64}') format('woff2'); }</style></defs>`
      : "";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
      ${fontDefs}
      <image href="data:${bgMime};base64,${bgBase64}" width="${width}" height="${height}"/>
      ${svgTexts}
    </svg>`;

    // Convert SVG to PNG using resvg
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: width },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Upload PNG to storage
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const fileName = `generated/${jobId || "manual"}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;

    const { error: uploadError } = await supabase.storage
      .from("loyalty-cards")
      .upload(fileName, pngBuffer, { contentType: "image/png" });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);

    return new Response(JSON.stringify({ imageUrl: publicUrlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-loyalty-card error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function getImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height };
  }
  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const h = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const w = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width: w, height: h };
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }
  return { width: 800, height: 500 };
}
