/**
 * Abnormal Bulk Sender — fully ephemeral.
 *
 * Upload an Excel sheet containing per-test rows (UMR, Mobile, Test Name,
 * Test Date, Result, Ref Range), group rows by `${UMR}|${MOBILE}` primary
 * key, render one Abnormal History card per group, upload to Cloudinary
 * (which auto-deletes after 7 days), and send via WhatsApp.
 *
 * **Nothing is persisted.** No DB rows are created, no message logs, no
 * CRM updates. The in-memory progress list is cleared on refresh / tab
 * change.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Play, Loader2, Download, AlertTriangle } from "lucide-react";
import { parseExcelFile } from "@/lib/excel";
import { generateAbnormalCardForDrip } from "@/lib/dripCardSenders";

const FIELDS = ["UMR", "Mobile", "Test Name", "Test Date", "Result", "Ref Range", "Patient Name"] as const;
type Field = typeof FIELDS[number];

interface GroupedPatient {
  primaryKey: string;
  umr: string;
  mobile: string;
  patientName: string;
  tests: Array<{ test_name: string; test_date: string; result_value: string; normal_range: string }>;
}

interface SendRow {
  primaryKey: string;
  patientName: string;
  mobile: string;
  status: "pending" | "sending" | "sent" | "failed";
  error?: string;
}

const normalizeMobile = (raw: unknown): string => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

const downloadSampleExcel = () => {
  const headers = ["UMR", "Mobile", "Patient Name", "Test Name", "Test Date", "Result", "Ref Range"];
  const sample = [
    ["UMR0021281", "9354210076", "John Doe", "Hemoglobin", "15-04-2026", "9.2", "13.0 - 17.0"],
    ["UMR0021281", "9354210076", "John Doe", "Glucose Fasting", "15-04-2026", "165", "70 - 110"],
    ["UMR0034512", "9876543210", "Jane Smith", "TSH", "12-04-2026", "8.5", "0.4 - 4.0"],
  ];
  const csv = [headers, ...sample].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Sample_Abnormal_Bulk_Send.csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

const AbnormalBulkSender = () => {
  const { toast } = useToast();

  const [excelData, setExcelData] = useState<Record<string, unknown>[]>([]);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<Field, string>>({
    UMR: "",
    Mobile: "",
    "Test Name": "",
    "Test Date": "",
    Result: "",
    "Ref Range": "",
    "Patient Name": "",
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [sendRows, setSendRows] = useState<SendRow[]>([]);

  const { data: cardTemplates = [] } = useQuery({
    queryKey: ["abnormal_card_templates_for_bulk"],
    queryFn: async () => {
      const { data } = await supabase
        .from("abnormal_card_templates")
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  useEffect(() => {
    if (!selectedTemplateId && cardTemplates.length > 0) {
      setSelectedTemplateId((cardTemplates[0] as { id: string }).id);
    }
  }, [cardTemplates, selectedTemplateId]);

  const autoMapColumns = useCallback((cols: string[]) => {
    const lower = cols.map((c) => c.toLowerCase().trim());
    const findCol = (...candidates: string[]): string => {
      for (const cand of candidates) {
        const idx = lower.findIndex((c) => c === cand.toLowerCase() || c.includes(cand.toLowerCase()));
        if (idx >= 0) return cols[idx];
      }
      return "";
    };
    setColumnMapping({
      UMR: findCol("umr", "umr number", "umr_no"),
      Mobile: findCol("mobile", "mobile number", "phone", "contact"),
      "Test Name": findCol("test name", "test", "parameter"),
      "Test Date": findCol("test date", "date"),
      Result: findCol("result", "value", "result value"),
      "Ref Range": findCol("ref range", "reference range", "normal range", "range"),
      "Patient Name": findCol("patient name", "name"),
    });
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      if (rows.length === 0) {
        toast({ title: "Empty file", variant: "destructive" });
        return;
      }
      const cols = Object.keys(rows[0]);
      setExcelData(rows);
      setExcelColumns(cols);
      autoMapColumns(cols);
      setSendRows([]);
      toast({ title: `Loaded ${rows.length} rows` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to parse Excel", description: msg, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  const groups = useMemo<GroupedPatient[]>(() => {
    if (excelData.length === 0) return [];
    if (!columnMapping.UMR || !columnMapping.Mobile) return [];

    const map = new Map<string, GroupedPatient>();
    for (const row of excelData) {
      const umrRaw = String(row[columnMapping.UMR] ?? "").trim();
      const mobile = normalizeMobile(row[columnMapping.Mobile]);
      if (!umrRaw || !mobile) continue;
      const primaryKey = `${umrRaw}|${mobile}`;
      const patientName = columnMapping["Patient Name"]
        ? String(row[columnMapping["Patient Name"]] ?? "").trim()
        : "";

      if (!map.has(primaryKey)) {
        map.set(primaryKey, {
          primaryKey,
          umr: umrRaw,
          mobile,
          patientName,
          tests: [],
        });
      }
      const g = map.get(primaryKey)!;
      if (patientName && !g.patientName) g.patientName = patientName;

      const testName = columnMapping["Test Name"] ? String(row[columnMapping["Test Name"]] ?? "").trim() : "";
      if (!testName) continue;
      g.tests.push({
        test_name: testName,
        test_date: columnMapping["Test Date"] ? String(row[columnMapping["Test Date"]] ?? "").trim() : "",
        result_value: columnMapping.Result ? String(row[columnMapping.Result] ?? "").trim() : "",
        normal_range: columnMapping["Ref Range"] ? String(row[columnMapping["Ref Range"]] ?? "").trim() : "",
      });
    }
    return Array.from(map.values()).filter((g) => g.tests.length > 0);
  }, [excelData, columnMapping]);

  const skippedRows = useMemo(() => {
    if (excelData.length === 0 || !columnMapping.UMR || !columnMapping.Mobile) return 0;
    let skipped = 0;
    for (const row of excelData) {
      const umrRaw = String(row[columnMapping.UMR] ?? "").trim();
      const mobile = normalizeMobile(row[columnMapping.Mobile]);
      if (!umrRaw || !mobile) skipped++;
    }
    return skipped;
  }, [excelData, columnMapping]);

  const handleSend = async () => {
    if (groups.length === 0) {
      return toast({ title: "No valid patient groups to send", variant: "destructive" });
    }
    if (!selectedTemplateId) {
      return toast({ title: "Select a card template", variant: "destructive" });
    }

    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "wa_global_%");
    const cfg: Record<string, string> = {};
    (settings || []).forEach((s: { setting_key: string; setting_value: string }) => {
      cfg[s.setting_key] = s.setting_value;
    });

    const { data: tmpl } = await supabase
      .from("marketing_templates")
      .select("whatsapp_template_name, body_mapping, api_base_url, from_number")
      .eq("template_name", "Abnormal PNG")
      .maybeSingle();

    const apiBaseUrl = cfg["wa_global_baseUrl"];
    const apiKey = cfg["wa_global_apiKey"];
    const templateName = (tmpl as { whatsapp_template_name?: string } | null)?.whatsapp_template_name || "";
    const authHeaderName = cfg["wa_global_authHeaderName"] || "apikey";
    const authHeaderPrefix = cfg["wa_global_authHeaderPrefix"] || "";
    const fromNumber = cfg["wa_global_fromNumber"] || "";
    const campaignName = (tmpl as { api_base_url?: string } | null)?.api_base_url || "";
    const includeMediaHeader = (tmpl as { from_number?: string } | null)?.from_number === "media_header_enabled";

    const queueEnabled = cfg["wa_global_queueEnabled"] !== "false";
    const delayRaw = Number(cfg["wa_global_delayMs"]);
    const delayMs = Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 1000;

    if (!apiBaseUrl || !apiKey || !templateName) {
      return toast({
        title: "WhatsApp not configured",
        description: "Set up Abnormal PNG template in Marketing Templates and WhatsApp Settings.",
        variant: "destructive",
      });
    }

    const cardTemplate = cardTemplates.find((t: { id: string }) => t.id === selectedTemplateId);

    setSending(true);
    setProgress({ current: 0, total: groups.length });
    const initialRows: SendRow[] = groups.map((g) => ({
      primaryKey: g.primaryKey,
      patientName: g.patientName || g.umr,
      mobile: g.mobile,
      status: "pending",
    }));
    setSendRows(initialRows);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      setSendRows((prev) =>
        prev.map((r) => (r.primaryKey === group.primaryKey ? { ...r, status: "sending" } : r)),
      );

      try {
        const imageUrl = await generateAbnormalCardForDrip(
          {
            patient_name: group.patientName || "",
            mobile_number: group.mobile,
            umr_number: group.umr,
          },
          group.tests,
          cardTemplate,
          "",
        );

        if (!imageUrl) throw new Error("Card generation failed");

        const toNumber = `+91${group.mobile}`;
        const components: Record<string, unknown> = {};
        if (includeMediaHeader) {
          components.header = { type: "image", image: { link: imageUrl } };
        }
        components.body = { params: [(group.patientName || group.umr).toUpperCase()] };

        const payload = {
          from: fromNumber,
          to: toNumber,
          templateName,
          campaignName,
          type: "template",
          components,
        };

        const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
          body: { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
        });

        const resStatus = (proxyRes.data as { status?: number } | null)?.status ?? 0;
        if (proxyRes.error || resStatus >= 400) {
          throw new Error(
            (proxyRes.data as { body?: string } | null)?.body?.slice(0, 200) ||
              proxyRes.error?.message ||
              `HTTP ${resStatus}`,
          );
        }

        setSendRows((prev) =>
          prev.map((r) => (r.primaryKey === group.primaryKey ? { ...r, status: "sent" } : r)),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSendRows((prev) =>
          prev.map((r) =>
            r.primaryKey === group.primaryKey ? { ...r, status: "failed", error: msg } : r,
          ),
        );
      }

      setProgress({ current: i + 1, total: groups.length });

      if (queueEnabled && delayMs > 0 && i < groups.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setSending(false);
    toast({ title: "Bulk send complete" });
  };

  const sentCount = sendRows.filter((r) => r.status === "sent").length;
  const failedCount = sendRows.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-4">
      <Card className="border-amber-300 bg-amber-50/50">
        <CardContent className="py-3 flex gap-2 items-start text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Ephemeral mode:</strong> nothing from this tab is saved. No database rows, no
            message log, no CRM updates. Card images are uploaded to Cloudinary (auto-deletes
            after 7 days) only because WhatsApp needs a public URL.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">1. Card Template & Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Abnormal Card Template</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent>
                  {cardTemplates.map((t: { id: string; name?: string }) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name || t.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Excel File (UMR, Mobile, Test Name, Test Date, Result, Ref Range)</Label>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-4 w-4 mr-1" />Upload</span>
                  </Button>
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
                </label>
                <Button variant="ghost" size="sm" onClick={downloadSampleExcel}>
                  <Download className="h-4 w-4 mr-1" />Sample
                </Button>
              </div>
              {excelData.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {excelData.length} rows loaded
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">2. Column Mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {FIELDS.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <Label className="text-xs w-28">{f}</Label>
                <Select
                  value={columnMapping[f] || ""}
                  onValueChange={(v) => setColumnMapping((prev) => ({ ...prev, [f]: v }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {excelColumns.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {excelData.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">3. Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm">
              <strong>{groups.length}</strong> unique patient cards from{" "}
              <strong>{excelData.length}</strong> rows
              {skippedRows > 0 && (
                <span className="text-amber-700"> · {skippedRows} rows skipped (missing UMR or invalid mobile)</span>
              )}
            </div>
            {groups.length > 0 && (
              <div className="overflow-auto max-h-48 border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Primary Key</TableHead>
                      <TableHead className="text-xs">Patient</TableHead>
                      <TableHead className="text-xs">Mobile</TableHead>
                      <TableHead className="text-xs text-right">Tests</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.slice(0, 10).map((g) => (
                      <TableRow key={g.primaryKey}>
                        <TableCell className="text-xs font-mono">{g.primaryKey}</TableCell>
                        <TableCell className="text-xs">{g.patientName || "—"}</TableCell>
                        <TableCell className="text-xs">{g.mobile}</TableCell>
                        <TableCell className="text-xs text-right">{g.tests.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {groups.length > 10 && (
                  <p className="text-xs text-muted-foreground p-2">+ {groups.length - 10} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-4">
        <Button onClick={handleSend} disabled={sending || groups.length === 0}>
          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          {sending ? "Sending..." : `Send to ${groups.length} patient${groups.length === 1 ? "" : "s"}`}
        </Button>
        {(sending || sendRows.length > 0) && (
          <div className="flex-1 max-w-md space-y-1">
            <Progress value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} />
            <p className="text-xs text-muted-foreground">
              {progress.current} / {progress.total}
              {sendRows.length > 0 && (
                <>
                  {" "}· <span className="text-green-700">{sentCount} sent</span>
                  {failedCount > 0 && <> · <span className="text-red-700">{failedCount} failed</span></>}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {sendRows.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Send Status (in-memory only)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-72 border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Patient</TableHead>
                    <TableHead className="text-xs">Mobile</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sendRows.map((r) => (
                    <TableRow key={r.primaryKey}>
                      <TableCell className="text-xs">{r.patientName}</TableCell>
                      <TableCell className="text-xs">{r.mobile}</TableCell>
                      <TableCell className="text-xs">
                        {r.status === "sent" && <span className="text-green-700">✓ Sent</span>}
                        {r.status === "failed" && <span className="text-red-700">✗ Failed</span>}
                        {r.status === "sending" && <span className="text-blue-700">Sending…</span>}
                        {r.status === "pending" && <span className="text-muted-foreground">Pending</span>}
                      </TableCell>
                      <TableCell className="text-xs text-red-700 max-w-xs truncate" title={r.error}>
                        {r.error || ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AbnormalBulkSender;
