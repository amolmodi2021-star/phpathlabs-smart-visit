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

const CRMAbnormalTests = () => {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendPhase, setSendPhase] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    try {
      const rows = await parseExcelFile(file);
      const mapped = rows
        .map((r) => {
          const keys = Object.keys(r);
          return {
            contact_primary_key: String(r[keys[0]] || "").trim(),
            test_name: String(r[keys[1]] || "").trim(),
            test_date: String(r[keys[2]] || "").trim(),
            result_value: String(r[keys[3]] || "").trim(),
            normal_range: String(r[keys[4]] || "").trim(),
          };
        })
        .filter((m) => m.contact_primary_key && m.test_name);

      if (!mapped.length) {
        toast.error("No valid rows found");
        return;
      }

      const BATCH = 100;
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("crm_abnormal_tests").insert(mapped.slice(i, i + BATCH));
        if (error) console.error(error);
      }
      toast.success(`Imported ${mapped.length} abnormal test records`);
      qc.invalidateQueries({ queryKey: ["crm-abnormal-tests"] });
    } catch {
      toast.error("Failed to parse file");
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

  // Generate abnormal history image card on canvas
  const generateAbnormalCard = async (
    group: PatientGroup
  ): Promise<string | null> => {
    try {
      const padding = 40;
      const headerHeight = 160;
      const rowHeight = 36;
      const tableHeaderHeight = 40;
      const width = 900;
      const height = headerHeight + tableHeaderHeight + group.tests.length * rowHeight + padding * 2 + 20;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // Background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);

      // Header bar
      ctx.fillStyle = "#2E3192";
      ctx.fillRect(0, 0, width, headerHeight);

      // Title
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 28px Arial, Helvetica, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("Abnormal Test History", padding, 20);

      // Patient info
      ctx.font = "18px Arial, Helvetica, sans-serif";
      ctx.fillText(`Name: ${group.patientName.toUpperCase()}`, padding, 60);
      ctx.fillText(`Mobile: ${group.mobile}`, padding, 88);
      ctx.fillText(`UMR: ${group.umr}`, padding + 400, 88);
      ctx.fillText(`Date: ${new Date().toLocaleDateString("en-GB")}`, padding, 116);

      // Table header
      const tableY = headerHeight + 10;
      ctx.fillStyle = "#F0F0F5";
      ctx.fillRect(padding, tableY, width - padding * 2, tableHeaderHeight);

      ctx.fillStyle = "#2E3192";
      ctx.font = "bold 15px Arial, Helvetica, sans-serif";
      const cols = [padding + 10, padding + 320, padding + 470, padding + 620];
      ctx.fillText("Test Name", cols[0], tableY + 12);
      ctx.fillText("Date", cols[1], tableY + 12);
      ctx.fillText("Result", cols[2], tableY + 12);
      ctx.fillText("Normal Range", cols[3], tableY + 12);

      // Table rows
      ctx.font = "14px Arial, Helvetica, sans-serif";
      group.tests.forEach((t, i) => {
        const y = tableY + tableHeaderHeight + i * rowHeight;

        if (i % 2 === 1) {
          ctx.fillStyle = "#F9F9FC";
          ctx.fillRect(padding, y, width - padding * 2, rowHeight);
        }

        // Row border
        ctx.strokeStyle = "#E0E0E8";
        ctx.beginPath();
        ctx.moveTo(padding, y + rowHeight);
        ctx.lineTo(width - padding, y + rowHeight);
        ctx.stroke();

        ctx.fillStyle = "#333333";
        ctx.fillText(t.test_name || "", cols[0], y + 10);
        ctx.fillText(t.test_date || "", cols[1], y + 10);

        // Highlight abnormal result in red
        ctx.fillStyle = "#CC0000";
        ctx.font = "bold 14px Arial, Helvetica, sans-serif";
        ctx.fillText(t.result_value || "", cols[2], y + 10);

        ctx.fillStyle = "#666666";
        ctx.font = "14px Arial, Helvetica, sans-serif";
        ctx.fillText(t.normal_range || "", cols[3], y + 10);
      });

      // Bottom border
      ctx.strokeStyle = "#2E3192";
      ctx.lineWidth = 2;
      ctx.strokeRect(padding, tableY, width - padding * 2, tableHeaderHeight + group.tests.length * rowHeight);

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
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Excel columns: Primary Key (UMR|Mobile), Test Name, Date, Result Value, Normal Range
          </p>
          <div className="flex gap-2 items-center">
            <Button size="sm" variant="outline" asChild>
              <a href="/samples/Sample_Abnormal_Tests.xlsx" download><Download className="h-4 w-4 mr-1" />Sample File</a>
            </Button>
            <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} className="flex-1" />
          </div>
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
