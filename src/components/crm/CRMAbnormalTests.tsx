import { useState, useCallback, useEffect } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, Send, ChevronDown, ChevronRight, Trash2, Download, ChevronLeft } from "lucide-react";
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
  testCount: number;
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

const PAGE_SIZE = 50;

const CRMAbnormalTests = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTests, setExpandedTests] = useState<Record<string, AbnormalTest[]>>({});
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendPhase, setSendPhase] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [page, setPage] = useState(0);
  const [staticExpiryDate, setStaticExpiryDate] = useState("");
  const qc = useQueryClient();

  // Load saved static expiry date
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", "abnormal_static_expiry_date")
        .maybeSingle();
      if (data?.setting_value) setStaticExpiryDate(data.setting_value);
    })();
  }, []);

  const handleExpiryDateChange = (val: string) => {
    setStaticExpiryDate(val);
    supabase.from("app_settings").upsert(
      { setting_key: "abnormal_static_expiry_date", setting_value: val, updated_at: new Date().toISOString() },
      { onConflict: "setting_key" }
    );
  };

  // One-time cleanup: delete any previously stored abnormal card images
  useEffect(() => {
    (async () => {
      try {
        const { data: files } = await supabase.storage.from("loyalty-cards").list("generated/abnormal", { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `generated/abnormal/${f.name}`);
          await supabase.storage.from("loyalty-cards").remove(paths);
          console.log(`Cleaned up ${paths.length} old abnormal card images`);
        }
      } catch (e) {
        console.warn("Storage cleanup failed:", e);
      }
    })();
  }, []);
  // Debounce search
  const searchTimerRef = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchTimerRef[0]) clearTimeout(searchTimerRef[0]);
    searchTimerRef[0] = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(0);
    }, 400);
  }, []);

  // Server-side paginated patient list
  const { data: patientsData, isLoading } = useQuery({
    queryKey: ["crm-abnormal-patients", debouncedSearch, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_abnormal_patients", {
        p_search: debouncedSearch,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return (data || []) as { contact_primary_key: string; test_count: number; patient_name: string; mobile_number: string; umr_number: string }[];
    },
  });

  const { data: totalCount = 0 } = useQuery({
    queryKey: ["crm-abnormal-patients-count", debouncedSearch],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_abnormal_patients_count", {
        p_search: debouncedSearch,
      });
      if (error) throw error;
      return (data as number) || 0;
    },
  });

  const { data: cardTemplates = [] } = useQuery({
    queryKey: ["abnormal-card-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("abnormal_card_templates").select("*").order("created_at", { ascending: false });
      return (data as any[]) || [];
    },
  });

  const fetchTestsForPatient = useCallback(async (pk: string) => {
    const { data, error } = await supabase
      .from("crm_abnormal_tests")
      .select("id, contact_primary_key, test_name, test_date, result_value, normal_range, created_at")
      .eq("contact_primary_key", pk)
      .order("test_name");

    if (error) throw error;

    const tests = (data as AbnormalTest[]) || [];
    setExpandedTests((prev) => ({ ...prev, [pk]: tests }));
    return tests;
  }, []);

  const groups: PatientGroup[] = (patientsData || []).map((p) => ({
    primaryKey: p.contact_primary_key,
    patientName: p.patient_name || p.contact_primary_key,
    mobile: p.mobile_number || "",
    umr: p.umr_number || "",
    tests: expandedTests[p.contact_primary_key] || [],
    testCount: Number(p.test_count),
  }));

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const toggleExpand = async (pk: string) => {
    const s = new Set(expanded);
    if (s.has(pk)) {
      s.delete(pk);
    } else {
      s.add(pk);
      if (!expandedTests[pk]) {
        await fetchTestsForPatient(pk);
      }
    }
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
    setImportProgress(5);
    setImportStats(null);

    try {
      // Parse Excel on the client side
      const rows = await parseExcelFile(file);
      const mapped = rows
        .map((r) => {
          const keys = Object.keys(r);
          let dateVal = String(r[keys[2]] || "").trim();
          // Convert Excel serial number to dd-mm-yyyy
          if (dateVal && /^\d{4,6}(\.\d+)?$/.test(dateVal)) {
            const serial = parseFloat(dateVal);
            if (serial > 1 && serial < 200000) {
              const epoch = new Date(Date.UTC(1899, 11, 30));
              epoch.setUTCDate(epoch.getUTCDate() + Math.floor(serial));
              const dd = String(epoch.getUTCDate()).padStart(2, "0");
              const mm = String(epoch.getUTCMonth() + 1).padStart(2, "0");
              const yyyy = epoch.getUTCFullYear();
              dateVal = `${dd}-${mm}-${yyyy}`;
            }
          }
          return {
            contact_primary_key: String(r[keys[0]] || "").trim(),
            test_name: String(r[keys[1]] || "").trim(),
            test_date: dateVal || null,
            result_value: String(r[keys[3]] || "").trim() || null,
            normal_range: String(r[keys[4]] || "").trim() || null,
          };
        })
        .filter((m) => m.contact_primary_key && m.test_name);

      if (!mapped.length) {
        toast.error("No valid rows found");
        setImporting(false);
        e.target.value = "";
        return;
      }

      setImportProgress(15);

      const stats: ImportStats = { total: mapped.length, inserted: 0, updated: 0, skippedDup: 0, skippedInvalid: rows.length - mapped.length };

      // Send parsed rows to backend in small batches
      const BATCH = 300;
      for (let i = 0; i < mapped.length; i += BATCH) {
        const batch = mapped.slice(i, i + BATCH);

        const { data, error } = await supabase.functions.invoke("abnormal-tests-import", {
          body: { rows: batch },
        });

        if (error) {
          console.error("Batch error:", error);
          toast.error(`Batch ${Math.floor(i / BATCH) + 1} failed`);
          continue;
        }

        if (data?.error) {
          console.error("Batch data error:", data.error);
          continue;
        }

        stats.inserted += data?.inserted || 0;
        stats.updated += data?.updated || 0;
        stats.skippedDup += data?.skippedDup || 0;

        setImportProgress(15 + Math.round(((i + batch.length) / mapped.length) * 85));
      }

      setImportProgress(100);
      setImportStats(stats);
      toast.success(`Done: ${stats.inserted} new, ${stats.updated} updated, ${stats.skippedDup} unchanged`);

      // Clear cached expanded test data so it reloads fresh
      setExpandedTests({});
      setExpanded(new Set());

      await Promise.all([
        qc.refetchQueries({ queryKey: ["crm-abnormal-patients"] }),
        qc.refetchQueries({ queryKey: ["crm-abnormal-patients-count"] }),
      ]);
    } catch (err) {
      console.error(err);
      toast.error("Failed to import file");
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
  ): Promise<{ publicUrl: string; filePath: string } | null> => {
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

      // Placeholder data (drawn last, after everything else)
      const phs: any[] = tmpl?.placeholders ? (typeof tmpl.placeholders === "string" ? JSON.parse(tmpl.placeholders) : tmpl.placeholders) : [];
      const designerSampleRows = 3; // designer uses 3 sample tests
      const rowDiff = (group.tests.length - designerSampleRows) * tRowHeight;
      const designerTableEndY = hdrH + bandsAboveH + tableHeaderH + designerSampleRows * tRowHeight;

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

      // Placeholders drawn LAST so they appear on top of all bands
      if (phs.length > 0) {
        for (const p of phs) {
          const px = (p.x / 100) * cw;
          let py = p.y;
          if (py > designerTableEndY) {
            py += rowDiff;
          }
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

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });

      const fileName = `generated/abnormal/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const { error: uploadError } = await supabase.storage
        .from("loyalty-cards")
        .upload(fileName, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);
      return { publicUrl: urlData.publicUrl, filePath: fileName };
    } catch (err) {
      console.error("Abnormal card generation failed:", err);
      return null;
    }
  };

  const handleSendWhatsApp = async () => {
    if (selected.size === 0) return toast.error("Select patients first");

    // Build full groups with tests loaded on demand
    const selectedGroups: PatientGroup[] = [];
    for (const g of groups) {
      if (!selected.has(g.primaryKey)) continue;
      let tests = expandedTests[g.primaryKey];
      if (!tests) {
        tests = await fetchTestsForPatient(g.primaryKey);
      }
      selectedGroups.push({ ...g, tests });
    }
    if (selectedGroups.length === 0) return toast.error("No patients selected");

    // Fetch WhatsApp settings (abnormal-specific)
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "abnormal_wa_%");

    const cfg: Record<string, string> = {};
    (settings || []).forEach((s: any) => {
      cfg[s.setting_key] = s.setting_value;
    });

    const apiBaseUrl = cfg["abnormal_wa_baseUrl"];
    const apiKey = cfg["abnormal_wa_apiKey"];
    const templateName = cfg["abnormal_wa_templateName"];
    const authHeaderName = cfg["abnormal_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = cfg["abnormal_wa_authHeaderPrefix"] || "";
    const fromNumber = cfg["abnormal_wa_fromNumber"] || "";
    const campaignName = cfg["abnormal_wa_campaignName"] || "";
    const includeMediaHeader = cfg["abnormal_wa_mediaHeader"] !== "false";
    const queueEnabled = cfg["abnormal_wa_queueEnabled"] !== "false";
    const delayMs = Number(cfg["abnormal_wa_delayMs"]) || 3000;

    if (!apiBaseUrl || !apiKey || !templateName) {
      return toast.error("WhatsApp API not configured. Set up in CRM → Abnormal WA Settings tab.");
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
      const cardResult = await generateAbnormalCard(group);
      if (!cardResult) {
        failed++;
        setSendProgress(Math.round(((i + 1) / selectedGroups.length) * 100));
        continue;
      }

      setSendPhase(`Sending WhatsApp ${i + 1}/${selectedGroups.length}...`);

      const toNumber = `+91${normalizedMobile}`;
      const components: Record<string, unknown> = {};
      if (includeMediaHeader) {
        components.header = { type: "image", image: { link: cardResult.publicUrl } };
      }
      components.body = { params: [group.patientName.toUpperCase()] };

      const payload: Record<string, unknown> = {
        from: fromNumber,
        to: toNumber,
        templateName,
        campaignName,
        type: "template",
        components,
      };

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

      // Always delete the generated card image from storage after sending
      try {
        await supabase.storage.from("loyalty-cards").remove([cardResult.filePath]);
      } catch (e) {
        console.warn("Failed to delete card image:", e);
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
            onChange={(e) => handleSearchChange(e.target.value)}
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
          {totalCount} patients (page {page + 1}/{totalPages || 1})
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
                <>
                  <TableRow key={g.primaryKey} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Checkbox
                        checked={selected.has(g.primaryKey)}
                        onCheckedChange={() => toggleSelect(g.primaryKey)}
                      />
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="font-medium">{g.patientName}</TableCell>
                    <TableCell>{g.mobile}</TableCell>
                    <TableCell className="font-mono text-xs">{g.umr}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{g.testCount} tests</Badge>
                    </TableCell>
                  </TableRow>
                  {expanded.has(g.primaryKey) && (
                    <TableRow key={`${g.primaryKey}-detail`}>
                      <TableCell colSpan={6} className="p-0">
                        <div className="bg-muted/30 px-8 py-2">
                          {g.tests.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2">Loading tests...</p>
                          ) : (
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
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

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
