import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, Send, ChevronDown, ChevronRight, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

interface AbnormalTest {
  id: string;
  contact_primary_key: string;
  test_name: string;
  test_date: string | null;
  result_value: string | null;
  normal_range: string | null;
  created_at: string;
}

interface PatientGroup {
  primaryKey: string;
  patientName: string;
  mobile: string;
  umr: string;
  tests: AbnormalTest[];
}

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

function drawBarcodeOnCanvas(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, height: number, color: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return;
  const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`;
  const codes = [105 as number];
  for (let i = 0; i < evenDigits.length; i += 2) codes.push(Number(evenDigits.slice(i, i + 2)));
  let checksum = 105;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(106);
  const patterns = codes.map((code) => CODE128_PATTERNS[code]).filter(Boolean);
  const totalModules = patterns.reduce((sum, p) => sum + p.split("").reduce((acc, w) => acc + Number(w), 0), 0);
  const targetWidth = Math.max(evenDigits.length * height * 0.38, height * 2.8);
  const moduleWidth = targetWidth / totalModules;
  ctx.save();
  ctx.fillStyle = color;
  let cursorX = x;
  for (const pattern of patterns) {
    pattern.split("").forEach((seg, idx) => {
      const width = Number(seg) * moduleWidth;
      if (idx % 2 === 0) ctx.fillRect(cursorX, y, width, height);
      cursorX += width;
    });
  }
  ctx.restore();
}

async function loadImageCORS(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

interface ImportStats {
  total: number;
  inserted: number;
  updated: number;
  skippedDup: number;
  skippedInvalid: number;
}

const CRMAbnormalTests = () => {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendPhase, setSendPhase] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const qc = useQueryClient();

  // Fetch all abnormal tests
  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["crm-abnormal-tests"],
    queryFn: async () => {
      const BATCH = 900;
      let all: AbnormalTest[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("crm_abnormal_tests")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all.push(...(data as AbnormalTest[]));
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  // Fetch contacts for name/mobile/umr lookup
  const { data: contacts = [] } = useQuery({
    queryKey: ["crm-contacts-lookup"],
    queryFn: async () => {
      const BATCH = 900;
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("crm_contacts")
          .select("primary_key, patient_name, mobile_number, umr_number")
          .range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  // Fetch abnormal card templates
  const { data: cardTemplates = [] } = useQuery({
    queryKey: ["abnormal-card-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("abnormal_card_templates").select("*").order("created_at", { ascending: false });
      return (data as any[]) || [];
    },
  });

  const contactMap = useMemo(() => {
    const map: Record<string, { name: string; mobile: string; umr: string }> = {};
    contacts.forEach((c: any) => {
      map[c.primary_key] = {
        name: c.patient_name || "",
        mobile: c.mobile_number || "",
        umr: c.umr_number || "",
      };
    });
    return map;
  }, [contacts]);

  // Group tests by primary_key
  const groups = useMemo(() => {
    const map = new Map<string, AbnormalTest[]>();
    tests.forEach((t) => {
      const existing = map.get(t.contact_primary_key) || [];
      existing.push(t);
      map.set(t.contact_primary_key, existing);
    });

    const result: PatientGroup[] = [];
    map.forEach((tests, pk) => {
      const contact = contactMap[pk];
      result.push({
        primaryKey: pk,
        patientName: contact?.name || pk.split("|")[0] || pk,
        mobile: contact?.mobile || pk.split("|")[1] || "",
        umr: contact?.umr || pk.split("|")[0] || "",
        tests: tests.sort((a, b) => (a.test_name || "").localeCompare(b.test_name || "")),
      });
    });

    if (search) {
      const q = search.toLowerCase();
      return result.filter(
        (g) =>
          g.patientName.toLowerCase().includes(q) ||
          g.mobile.includes(q) ||
          g.umr.toLowerCase().includes(q) ||
          g.primaryKey.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => a.patientName.localeCompare(b.patientName));
  }, [tests, contactMap, search]);

  const toggleExpand = (pk: string) => {
    const s = new Set(expanded);
    s.has(pk) ? s.delete(pk) : s.add(pk);
    setExpanded(s);
  };

  const toggleSelect = (pk: string) => {
    const s = new Set(selected);
    s.has(pk) ? s.delete(pk) : s.add(pk);
    setSelected(s);
  };

  const toggleSelectAll = () => {
    if (selected.size === groups.length) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.primaryKey)));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportProgress(0);
    setImportStats(null);
    try {
      const rows = await parseExcelFile(file);
      const mapped = rows
        .map((r) => {
          const keys = Object.keys(r);
          return {
            contact_primary_key: String(r[keys[0]] || "").trim(),
            test_name: String(r[keys[1]] || "").trim(),
            test_date: String(r[keys[2]] || "").trim() || null,
            result_value: String(r[keys[3]] || "").trim() || null,
            normal_range: String(r[keys[4]] || "").trim() || null,
          };
        })
        .filter((m) => m.contact_primary_key && m.test_name);

      if (!mapped.length) {
        toast.error("No valid rows found");
        return;
      }

      // Fetch ALL existing abnormal test records (batched to bypass 1000 limit)
      const existingMap = new Map<string, { id: string; result_value: string | null; normal_range: string | null }>();
      {
        const FETCH_BATCH = 900;
        let from = 0;
        let keepFetching = true;
        while (keepFetching) {
          const { data: chunk } = await supabase
            .from("crm_abnormal_tests")
            .select("id, contact_primary_key, test_name, test_date, result_value, normal_range")
            .order("created_at", { ascending: true })
            .range(from, from + FETCH_BATCH - 1);
          if (!chunk || chunk.length === 0) break;
          for (const c of chunk) {
            const key = `${c.contact_primary_key}||${c.test_name}||${c.test_date || ""}`;
            existingMap.set(key, { id: c.id, result_value: c.result_value, normal_range: c.normal_range });
          }
          if (chunk.length < FETCH_BATCH) keepFetching = false;
          else from += FETCH_BATCH;
        }
      }
      setImportProgress(10);

      const stats: ImportStats = { total: mapped.length, inserted: 0, updated: 0, skippedDup: 0, skippedInvalid: 0 };
      const toInsert: typeof mapped = [];
      const toUpdate: { id: string; result_value: string | null; normal_range: string | null }[] = [];
      const seenKeys = new Set<string>();

      for (const row of mapped) {
        const dedupKey = `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}`;
        
        // Skip duplicates within the same file
        if (seenKeys.has(dedupKey)) {
          stats.skippedDup++;
          continue;
        }
        seenKeys.add(dedupKey);

        const existing = existingMap.get(dedupKey);
        if (existing) {
          // Check if result_value or normal_range changed
          if (existing.result_value !== row.result_value || existing.normal_range !== row.normal_range) {
            toUpdate.push({ id: existing.id, result_value: row.result_value, normal_range: row.normal_range });
            stats.updated++;
          } else {
            stats.skippedDup++;
          }
        } else {
          toInsert.push(row);
          stats.inserted++;
        }
      }

      // Batch insert new records
      const INSERT_BATCH = 200;
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("crm_abnormal_tests").insert(toInsert.slice(i, i + INSERT_BATCH));
        if (error) console.error("Insert error:", error);
        setImportProgress(10 + Math.round(((i + INSERT_BATCH) / (toInsert.length + toUpdate.length || 1)) * 80));
      }

      // Batch update changed records
      const UPDATE_BATCH = 50;
      for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
        const batch = toUpdate.slice(i, i + UPDATE_BATCH);
        await Promise.all(
          batch.map((u) =>
            supabase
              .from("crm_abnormal_tests")
              .update({ result_value: u.result_value, normal_range: u.normal_range })
              .eq("id", u.id)
          )
        );
        setImportProgress(10 + Math.round(((toInsert.length + i + UPDATE_BATCH) / (toInsert.length + toUpdate.length || 1)) * 80));
      }

      setImportProgress(100);
      setImportStats(stats);
      toast.success(`Done: ${stats.inserted} new, ${stats.updated} updated, ${stats.skippedDup} unchanged`);
      qc.invalidateQueries({ queryKey: ["crm-abnormal-tests"] });
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse/import file");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    const pks = Array.from(selected);
    for (let i = 0; i < pks.length; i += 50) {
      await supabase.from("crm_abnormal_tests").delete().in("contact_primary_key", pks.slice(i, i + 50));
    }
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm-abnormal-tests"] });
    toast.success(`Deleted tests for ${pks.length} patients`);
  };

  // Generate abnormal history image card on canvas — template-driven
  const generateAbnormalCard = async (
    group: PatientGroup
  ): Promise<string | null> => {
    try {
      // Load template if selected
      const tmpl = cardTemplates.find((t: any) => t.id === selectedTemplateId);
      const padding = 40;
      const showHdr = tmpl?.show_header_band !== false;
      const hdrH = showHdr ? (tmpl?.header_band_height ?? 160) : 0;
      const tableHeaderH = 40;
      const cw = tmpl?.canvas_width || 900;
      const bgColor = tmpl?.background_color || "#FFFFFF";
      const headerBg = tmpl?.header_bg_color || "#2E3192";
      const headerFontCol = tmpl?.header_font_color || "#FFFFFF";

      const tc = tmpl?.table_config ? (typeof tmpl.table_config === "string" ? JSON.parse(tmpl.table_config) : tmpl.table_config) : {};
      const tHeaderBg = tc.headerBg || "#2E3192";
      const tHeaderFontSize = tc.headerFontSize || 15;
      const tHeaderFontColor = tc.headerFontColor || "#FFFFFF";
      const tRowFontSize = tc.rowFontSize || 14;
      const tRowFontColor = tc.rowFontColor || "#333333";
      const tResultColor = tc.resultColor || "#CC0000";
      const tBorderColor = tc.borderColor || "#E0E0E8";
      const tAltRowColor = tc.altRowColor || "#F9F9FC";
      const tRowHeight = tc.rowHeight || 36;
      const colWidths: number[] = tc.colWidths || [0.38, 0.18, 0.18, 0.26];

      const footerLinesArr: any[] = tmpl?.footer_lines ? (typeof tmpl.footer_lines === "string" ? JSON.parse(tmpl.footer_lines) : tmpl.footer_lines) : [];
      const footerH = footerLinesArr.reduce((s: number, l: any) => s + (l.fontSize || 12) + 8, 0) + 20;

      const bandsArr: any[] = tmpl?.bands ? (typeof tmpl.bands === "string" ? JSON.parse(tmpl.bands) : tmpl.bands) : [];
      const bandsAboveH = bandsArr.filter((b: any) => b.position === "above-table").reduce((s: number, b: any) => s + (b.height || 40), 0);
      const bandsBelowH = bandsArr.filter((b: any) => b.position === "below-table").reduce((s: number, b: any) => s + (b.height || 40), 0);

      const height = hdrH + bandsAboveH + tableHeaderH + group.tests.length * tRowHeight + bandsBelowH + footerH + padding * 2;

      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, cw, height);

      // Header band
      if (showHdr) {
        ctx.fillStyle = headerBg;
        ctx.fillRect(0, 0, cw, hdrH);
      }

      // Logo
      if (tmpl?.logo_url) {
        try {
          const logoImg = await loadImageCORS(tmpl.logo_url);
          const lx = ((tmpl.logo_x ?? 2) / 100) * cw;
          const ly = ((tmpl.logo_y ?? 2) / 100) * hdrH;
          ctx.drawImage(logoImg, lx, ly, tmpl.logo_width || 120, tmpl.logo_height || 60);
        } catch (e) {
          console.warn("Logo load failed:", e);
        }
      }

      // Header placeholders
      const phs: any[] = tmpl?.placeholders ? (typeof tmpl.placeholders === "string" ? JSON.parse(tmpl.placeholders) : tmpl.placeholders) : [];
      if (phs.length > 0) {
        for (const p of phs) {
          const px = (p.x / 100) * cw;
          const py = (p.y / 100) * height;
          if (p.field === "Barcode") {
            drawBarcodeOnCanvas(ctx, group.mobile, px, py, p.fontSize || 20, p.fontColor || headerFontCol);
          } else {
            ctx.font = `${p.bold ? "bold " : ""}${p.fontSize || 18}px Arial, Helvetica, sans-serif`;
            ctx.fillStyle = p.fontColor || headerFontCol;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            const val = p.field === "Name" ? group.patientName.toUpperCase() : p.field === "Mobile" ? `Mobile: ${group.mobile}` : `UMR: ${group.umr}`;
            ctx.fillText(val, px, py);
          }
        }
      } else {
        // Fallback: no template placeholders
        ctx.fillStyle = headerFontCol;
        ctx.font = "bold 28px Arial, Helvetica, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("Abnormal Test History", padding, 20);
        ctx.font = "18px Arial, Helvetica, sans-serif";
        ctx.fillText(`Name: ${group.patientName.toUpperCase()}`, padding, 60);
        ctx.fillText(`Mobile: ${group.mobile}`, padding, 88);
        ctx.fillText(`UMR: ${group.umr}`, padding + 400, 88);
        ctx.fillText(`Date: ${new Date().toLocaleDateString("en-GB")}`, padding, 116);
      }

      // Draw bands helper
      const drawBandOnCanvas = (ctx: CanvasRenderingContext2D, band: any, y: number, canvasW: number) => {
        ctx.fillStyle = band.color || "#2E3192";
        ctx.fillRect(0, y, canvasW, band.height || 40);
        if (band.text) {
          ctx.fillStyle = band.textColor || "#FFFFFF";
          ctx.font = `${band.bold ? "bold " : ""}${band.fontSize || 14}px Arial, sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = band.align === "center" ? "center" : band.align === "right" ? "right" : "left";
          const tx = band.align === "center" ? canvasW / 2 : band.align === "right" ? canvasW - padding : padding;
          ctx.fillText(band.text, tx, y + (band.height || 40) / 2);
        }
      };

      // Bands above table
      let cursorY = hdrH;
      bandsArr.filter((b: any) => b.position === "above-table").forEach((b: any) => {
        drawBandOnCanvas(ctx, b, cursorY, cw);
        cursorY += b.height || 40;
      });

      // Table
      const tableY = cursorY + 10;
      const tableW = cw - padding * 2;
      const colStarts = [0, colWidths[0], colWidths[0] + colWidths[1], colWidths[0] + colWidths[1] + colWidths[2]].map(
        (f) => padding + f * tableW + 10
      );

      // Table header
      ctx.fillStyle = tHeaderBg;
      ctx.fillRect(padding, tableY, tableW, tableHeaderH);
      ctx.fillStyle = tHeaderFontColor;
      ctx.font = `bold ${tHeaderFontSize}px Arial, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText("Test Name", colStarts[0], tableY + 12);
      ctx.fillText("Date", colStarts[1], tableY + 12);
      ctx.fillText("Result", colStarts[2], tableY + 12);
      ctx.fillText("Normal Range", colStarts[3], tableY + 12);

      // Table rows
      group.tests.forEach((t, i) => {
        const y = tableY + tableHeaderH + i * tRowHeight;
        if (i % 2 === 1) {
          ctx.fillStyle = tAltRowColor;
          ctx.fillRect(padding, y, tableW, tRowHeight);
        }
        ctx.strokeStyle = tBorderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, y + tRowHeight);
        ctx.lineTo(padding + tableW, y + tRowHeight);
        ctx.stroke();

        ctx.fillStyle = tRowFontColor;
        ctx.font = `${tRowFontSize}px Arial, sans-serif`;
        ctx.fillText(t.test_name || "", colStarts[0], y + 10);
        ctx.fillText(t.test_date || "", colStarts[1], y + 10);

        ctx.fillStyle = tResultColor;
        ctx.font = `bold ${tRowFontSize}px Arial, sans-serif`;
        ctx.fillText(t.result_value || "", colStarts[2], y + 10);

        ctx.fillStyle = tRowFontColor;
        ctx.font = `${tRowFontSize}px Arial, sans-serif`;
        ctx.fillText(t.normal_range || "", colStarts[3], y + 10);
      });

      // Table border
      ctx.strokeStyle = tHeaderBg;
      ctx.lineWidth = 2;
      ctx.strokeRect(padding, tableY, tableW, tableHeaderH + group.tests.length * tRowHeight);

      // Bands below table
      let belowY = tableY + tableHeaderH + group.tests.length * tRowHeight + 10;
      bandsArr.filter((b: any) => b.position === "below-table").forEach((b: any) => {
        drawBandOnCanvas(ctx, b, belowY, cw);
        belowY += b.height || 40;
      });

      // Footer lines
      let fy = belowY + 10;
      footerLinesArr.forEach((fl: any) => {
        ctx.fillStyle = fl.fontColor || "#666666";
        ctx.font = `${fl.bold ? "bold " : ""}${fl.fontSize || 12}px Arial, sans-serif`;
        ctx.textAlign = fl.align === "center" ? "center" : fl.align === "right" ? "right" : "left";
        const fx = fl.align === "center" ? cw / 2 : fl.align === "right" ? cw - padding : padding;
        ctx.fillText(fl.text || "", fx, fy);
        fy += (fl.fontSize || 12) + 8;
      });
      ctx.textAlign = "left";

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });

      const fileName = `generated/abnormal/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const { error: uploadError } = await supabase.storage
        .from("loyalty-cards")
        .upload(fileName, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (err) {
      console.error("Abnormal card generation failed:", err);
      return null;
    }
  };

  const handleSendWhatsApp = async () => {
    if (selected.size === 0) return toast.error("Select patients first");

    const selectedGroups = groups.filter((g) => selected.has(g.primaryKey));
    if (selectedGroups.length === 0) return toast.error("No patients selected");

    // Fetch WhatsApp settings (same as loyalty cards)
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "loyalty_%");

    const cfg: Record<string, string> = {};
    (settings || []).forEach((s: any) => {
      cfg[s.setting_key] = s.setting_value;
    });

    const apiBaseUrl = cfg["loyalty_wa_baseUrl"];
    const apiKey = cfg["loyalty_wa_apiKey"];
    const templateName = cfg["loyalty_wa_templateName"];
    const authHeaderName = cfg["loyalty_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = cfg["loyalty_wa_authHeaderPrefix"] || "";
    const fromNumber = cfg["loyalty_wa_fromNumber"] || "";
    const campaignName = cfg["loyalty_wa_campaignName"] || "";
    const queueEnabled = cfg["loyalty_wa_queueEnabled"] !== "false";
    const delayMs = Number(cfg["loyalty_wa_delayMs"]) || 3000;

    if (!apiBaseUrl || !apiKey || !templateName) {
      return toast.error("WhatsApp API not configured. Set up in Loyalty Cards → WhatsApp Settings.");
    }

    setSending(true);
    setSendProgress(0);
    setSendPhase("Generating abnormal history cards...");

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < selectedGroups.length; i++) {
      const group = selectedGroups[i];
      const normalizedMobile = group.mobile.replace(/\D/g, "").slice(-10);

      if (!normalizedMobile || normalizedMobile.length !== 10) {
        failed++;
        setSendProgress(Math.round(((i + 1) / selectedGroups.length) * 100));
        continue;
      }

      setSendPhase(`Generating card ${i + 1}/${selectedGroups.length}...`);

      // Generate image card
      const imageUrl = await generateAbnormalCard(group);
      if (!imageUrl) {
        failed++;
        setSendProgress(Math.round(((i + 1) / selectedGroups.length) * 100));
        continue;
      }

      setSendPhase(`Sending WhatsApp ${i + 1}/${selectedGroups.length}...`);

      const toNumber = `+91${normalizedMobile}`;
      const components: Record<string, unknown> = {};
      components.header = { type: "image", image: { link: imageUrl } };

      const payload: Record<string, unknown> = {
        from: fromNumber,
        to: toNumber,
        templateName,
        campaignName,
        type: "template",
      };
      if (Object.keys(components).length > 0) {
        payload.components = components;
      }

      try {
        const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
          body: { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
        });

        if (proxyRes.error || proxyRes.data?.status >= 400) {
          failed++;
        } else {
          sent++;
          // Update contact record
          await supabase
            .from("crm_contacts")
            .update({
              last_sent_type: "Abnormal History",
              last_sent_date: new Date().toISOString(),
            })
            .eq("primary_key", group.primaryKey);
        }
      } catch {
        failed++;
      }

      setSendProgress(Math.round(((i + 1) / selectedGroups.length) * 100));

      if (queueEnabled && delayMs > 0 && i < selectedGroups.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    setSending(false);
    setSendPhase("");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    qc.invalidateQueries({ queryKey: ["crm-sent-history"] });
    toast.success(`Abnormal History sent: ${sent} success, ${failed} failed`);
  };

  return (
    <div className="space-y-4">
      {sending && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
          <p className="text-sm font-medium">{sendPhase}</p>
          <Progress value={sendProgress} />
          <p className="text-xs text-muted-foreground">{sendProgress}% complete</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload Abnormal Test Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Excel columns: Primary Key (UMR|Mobile), Test Name, Date, Result Value, Normal Range.
            Duplicates are auto-detected. Changed results are updated automatically.
          </p>
          <div className="flex gap-2 items-center">
            <Button size="sm" variant="outline" asChild>
              <a href="/samples/Sample_Abnormal_Tests.xlsx" download><Download className="h-4 w-4 mr-1" />Sample File</a>
            </Button>
            <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} className="flex-1" />
          </div>
          {importing && <Progress value={importProgress} />}
          {importStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="p-2 bg-muted rounded"><span className="font-medium">Total Rows:</span> {importStats.total}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">New:</span> {importStats.inserted}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Updated:</span> {importStats.updated}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Unchanged:</span> {importStats.skippedDup}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Invalid:</span> {importStats.skippedInvalid}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, mobile, UMR, primary key..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {selected.size > 0 && (
          <>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Card Template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (no template)</SelectItem>
                {cardTemplates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleSendWhatsApp} disabled={sending}>
              <Send className="h-4 w-4 mr-1" />
              Send Abnormal Card ({selected.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete ({selected.size})
            </Button>
          </>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {groups.length} patients, {tests.length} tests
        </span>
      </div>

      <div className="border rounded-lg overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={groups.length > 0 && selected.size === groups.length}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead>Patient Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>UMR</TableHead>
              <TableHead>Tests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  No abnormal tests found.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) => (
                <Collapsible key={g.primaryKey} asChild>
                  <>
                    <TableRow className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Checkbox
                          checked={selected.has(g.primaryKey)}
                          onCheckedChange={() => toggleSelect(g.primaryKey)}
                        />
                      </TableCell>
                      <TableCell>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleExpand(g.primaryKey)}
                          >
                            {expanded.has(g.primaryKey) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TableCell>
                      <TableCell className="font-medium">{g.patientName}</TableCell>
                      <TableCell>{g.mobile}</TableCell>
                      <TableCell className="font-mono text-xs">{g.umr}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{g.tests.length} tests</Badge>
                      </TableCell>
                    </TableRow>
                    {expanded.has(g.primaryKey) && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <div className="bg-muted/30 px-8 py-2">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Test Name</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Result</TableHead>
                                  <TableHead>Normal Range</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {g.tests.map((t) => (
                                  <TableRow key={t.id}>
                                    <TableCell>{t.test_name}</TableCell>
                                    <TableCell>{t.test_date}</TableCell>
                                    <TableCell className="text-destructive font-semibold">
                                      {t.result_value}
                                    </TableCell>
                                    <TableCell>{t.normal_range}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                </Collapsible>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DeletePasswordDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onSuccess={handleDeleteSelected}
        description={`Delete all abnormal tests for ${selected.size} selected patients?`}
      />
    </div>
  );
};

export default CRMAbnormalTests;
