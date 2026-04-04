import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Trash2, CheckCircle, Send, Search } from "lucide-react";
import { toast } from "sonner";
import { generateAndUploadCard, getTemplateAssets, type CardData } from "@/lib/cardRenderer";

const CRMImportReview = () => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [approving, setApproving] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filterType, setFilterType] = useState<"all" | "blacklisted" | "new" | "update">("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sendPhase, setSendPhase] = useState<string>("");
  const qc = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ["loyalty_card_templates"],
    queryFn: async () => {
      const { data } = await supabase.from("loyalty_card_templates").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: staged = [], isLoading } = useQuery({
    queryKey: ["crm-staging"],
    queryFn: async () => {
      const BATCH = 900;
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("crm_import_staging")
          .select("*")
          .order("created_at", { ascending: true })
          .range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  const filtered = staged.filter((r: any) => {
    if (filterType === "blacklisted" && !r.is_blacklisted) return false;
    if (filterType === "new" && r.is_update) return false;
    if (filterType === "update" && !r.is_update) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        (r.patient_name || "").toLowerCase().includes(s) ||
        (r.mobile_number || "").includes(s) ||
        (r.umr_number || "").includes(s)
      );
    }
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r: any) => r.id)));
    }
  };

  const handleRemoveSelected = async () => {
    if (selected.size === 0) return toast.error("Select records to remove");
    const ids = Array.from(selected);
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      await supabase.from("crm_import_staging").delete().in("id", ids.slice(i, i + BATCH));
    }
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm-staging"] });
    toast.success(`Removed ${ids.length} records from staging`);
  };

  const handleRemoveBlacklisted = async () => {
    const blIds = staged.filter((r: any) => r.is_blacklisted).map((r: any) => r.id);
    if (blIds.length === 0) return toast.info("No blacklisted records");
    const BATCH = 200;
    for (let i = 0; i < blIds.length; i += BATCH) {
      await supabase.from("crm_import_staging").delete().in("id", blIds.slice(i, i + BATCH));
    }
    qc.invalidateQueries({ queryKey: ["crm-staging"] });
    toast.success(`Removed ${blIds.length} blacklisted records`);
  };

  const handleDiscountChange = async (id: string, val: string) => {
    const num = parseFloat(val) || 0;
    await supabase.from("crm_import_staging").update({ default_discount_pct: num }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["crm-staging"] });
  };

  const handleApprove = async () => {
    const toApprove = staged.filter((r: any) => !r.is_blacklisted);
    if (toApprove.length === 0) return toast.error("No non-blacklisted records to approve");
    setApproving(true);
    setProgress(0);

    const BATCH = 200;
    let done = 0;

    for (let i = 0; i < toApprove.length; i += BATCH) {
      const batch = toApprove.slice(i, i + BATCH);
      const upsertData = batch.map((r: any) => ({
        primary_key: r.primary_key,
        patient_name: r.patient_name,
        mobile_number: r.mobile_number,
        umr_number: r.umr_number,
        location: r.location,
        bill_number: r.bill_number,
        visit_date: r.location === "NON PHPL" ? null : r.visit_date,
        visit_type: r.visit_type,
        gross_amount: r.gross_amount || 0,
        discount_amount: r.discount_amount || 0,
        net_amount: r.net_amount || 0,
        paid_amount: r.paid_amount || 0,
        due_amount: r.due_amount || 0,
        payment_type: r.payment_type,
        remarks: r.remarks,
        created_by: r.created_by,
        doctor_name: r.doctor_name,
        default_discount_pct: r.default_discount_pct,
        record_tag: r.record_tag || "DAILY",
      }));

      const { error } = await supabase.from("crm_contacts").upsert(upsertData, { onConflict: "primary_key" });
      if (error) console.error("Approve upsert error:", error);
      done += batch.length;
      setProgress(Math.round((done / toApprove.length) * 100));
    }

    // Clear staging
    await supabase.from("crm_import_staging").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    setApproving(false);
    setProgress(100);
    qc.invalidateQueries({ queryKey: ["crm-staging"] });
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    qc.invalidateQueries({ queryKey: ["crm-contacts-count"] });
    toast.success(`${toApprove.length} records approved and transferred to Contacts!`);
  };

  const handleSendLoyaltyCards = async () => {
    const targets = selected.size > 0
      ? staged.filter((r: any) => selected.has(r.id) && !r.is_blacklisted)
      : staged.filter((r: any) => !r.is_blacklisted);

    if (targets.length === 0) return toast.error("No valid records to send");
    if (!selectedTemplateId) return toast.error("Select a card template first");

    // Fetch WhatsApp settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "loyalty_%");

    const cfg: Record<string, string> = {};
    (settings || []).forEach((s: any) => { cfg[s.setting_key] = s.setting_value; });

    const apiBaseUrl = cfg["loyalty_wa_baseUrl"];
    const apiKey = cfg["loyalty_wa_apiKey"];
    const templateName = cfg["loyalty_wa_templateName"];
    const authHeaderName = cfg["loyalty_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = cfg["loyalty_wa_authHeaderPrefix"] || "";
    const fromNumber = cfg["loyalty_wa_fromNumber"] || "";
    const campaignName = cfg["loyalty_wa_campaignName"] || "";
    const bodyMapping = cfg["loyalty_wa_bodyMapping"];
    const queueEnabled = cfg["loyalty_wa_queueEnabled"] !== "false";
    const delayMs = Number(cfg["loyalty_wa_delayMs"]) || 3000;
    const useStaticExpiry = cfg["loyalty_static_expiry_enabled"] === "true";
    const staticExpiryDate = cfg["loyalty_static_expiry_date"] || "";

    if (!apiBaseUrl || !apiKey || !templateName) {
      return toast.error("WhatsApp API not configured. Set up in Loyalty Cards → WhatsApp Settings.");
    }

    let mapping: Record<string, string> = {};
    try { mapping = bodyMapping ? JSON.parse(bodyMapping) : {}; } catch { mapping = {}; }

    setSending(true);
    setProgress(0);

    // Phase 1: Generate card images
    setSendPhase("Generating card images...");
    let templateAssets: Awaited<ReturnType<typeof getTemplateAssets>>;
    try {
      templateAssets = await getTemplateAssets(selectedTemplateId);
      if (!templateAssets) throw new Error("Template not found or has no background image");
    } catch (err: any) {
      setSending(false);
      setSendPhase("");
      return toast.error(err.message || "Failed to load template");
    }

    const { bgImg, canvas, ctx, placeholders } = templateAssets;
    const imageUrls: (string | null)[] = [];

    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      const mobile = (r.mobile_number || "").replace(/\D/g, "");
      const normalizedMobile = mobile.length > 10 ? mobile.slice(-10) : mobile;

      // Check if card image already exists
      const { data: existingCard } = await supabase
        .from("loyalty_cards")
        .select("image_url")
        .eq("mobile", normalizedMobile)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingCard?.image_url) {
        imageUrls.push(existingCard.image_url);
      } else {
        // Generate new card
        const cardData: CardData = {
          Name: r.patient_name || "",
          Mobile: normalizedMobile,
          UMR: r.umr_number || "",
          "Discount %": `${r.default_discount_pct ?? 20}%`,
          "Expiry Date": useStaticExpiry && staticExpiryDate ? staticExpiryDate : "",
        };

        const imageUrl = await generateAndUploadCard(selectedTemplateId, cardData, bgImg, canvas, ctx, placeholders);
        imageUrls.push(imageUrl);

        // Also save to loyalty_cards table for future lookups
        if (imageUrl) {
          await supabase.from("loyalty_cards").insert({
            patient_name: cardData.Name,
            mobile: normalizedMobile,
            umr: cardData.UMR,
            discount: cardData["Discount %"],
            expiry_date: cardData["Expiry Date"],
            image_url: imageUrl,
            whatsapp_status: "pending",
          });
        }
      }
      setProgress(Math.round(((i + 1) / targets.length) * 50)); // 0-50% for generation
    }

    // Phase 2: Send WhatsApp
    setSendPhase("Sending WhatsApp messages...");
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      const rawMobile = (r.mobile_number || "").replace(/\D/g, "");
      const normalizedMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile;
      const toNumber = normalizedMobile ? `+91${normalizedMobile}` : "";

      const components: Record<string, unknown> = {};

      if (Object.keys(mapping).length > 0) {
        const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
        const params: string[] = sortedKeys.map((key) => {
          const field = mapping[key];
          switch (field) {
            case "Name": return r.patient_name || "";
            case "Mobile": return r.mobile_number || "";
            case "UMR": return r.umr_number || "";
            case "Discount %": return `${r.default_discount_pct ?? 20}%`;
            case "Expiry Date": return "";
            default: return "";
          }
        });
        components.body = { params };
      }

      const imgUrl = imageUrls[i];
      if (imgUrl) {
        components.header = { type: "image", image: { link: imgUrl } };
      }

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
          console.error("WA proxy error:", proxyRes.data);
          failed++;
        } else {
          sent++;
          const pk = r.primary_key;
          if (pk) {
            await supabase.from("crm_contacts").update({
              last_sent_type: "ABC Card",
              last_sent_date: new Date().toISOString(),
            }).eq("primary_key", pk);
          }
          // Update loyalty_cards whatsapp_status
          if (normalizedMobile) {
            await supabase.from("loyalty_cards")
              .update({ whatsapp_status: "sent", sent_at: new Date().toISOString() })
              .eq("mobile", normalizedMobile)
              .eq("whatsapp_status", "pending")
              .order("created_at", { ascending: false })
              .limit(1);
          }
        }
      } catch {
        failed++;
      }
      setProgress(50 + Math.round(((i + 1) / targets.length) * 50)); // 50-100% for sending

      if (queueEnabled && delayMs > 0 && i < targets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    setSending(false);
    setSendPhase("");
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    toast.success(`WhatsApp sent: ${sent} success, ${failed} failed`);
  };

  const blacklistedCount = staged.filter((r: any) => r.is_blacklisted).length;
  const newCount = staged.filter((r: any) => !r.is_update).length;
  const updateCount = staged.filter((r: any) => r.is_update).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>Review Staged Import ({staged.length} records)</span>
            <div className="flex gap-2 flex-wrap items-center">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Card Template:</Label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger className="h-8 w-[180px]">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="destructive" size="sm" onClick={handleRemoveBlacklisted} disabled={blacklistedCount === 0}>
                <Trash2 className="h-4 w-4 mr-1" />Remove Blacklisted ({blacklistedCount})
              </Button>
              <Button variant="destructive" size="sm" onClick={handleRemoveSelected} disabled={selected.size === 0}>
                <Trash2 className="h-4 w-4 mr-1" />Remove Selected ({selected.size})
              </Button>
              <Button size="sm" onClick={handleSendLoyaltyCards} disabled={sending || staged.length === 0 || !selectedTemplateId}>
                <Send className="h-4 w-4 mr-1" />{sending ? "Sending..." : `Send Loyalty Card (${selected.size > 0 ? selected.size : staged.filter((r: any) => !r.is_blacklisted).length})`}
              </Button>
              <Button size="sm" onClick={handleApprove} disabled={approving || staged.length === 0}>
                <CheckCircle className="h-4 w-4 mr-1" />{approving ? "Approving..." : "Approve & Transfer to Contacts"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(approving || sending) && (
            <div className="space-y-1">
              <Progress value={progress} />
              {sendPhase && <p className="text-xs text-muted-foreground">{sendPhase}</p>}
            </div>
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search name, mobile, UMR..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              <Badge variant={filterType === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterType("all")}>
                All ({staged.length})
              </Badge>
              <Badge variant={filterType === "new" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterType("new")}>
                New ({newCount})
              </Badge>
              <Badge variant={filterType === "update" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterType("update")}>
                Updates ({updateCount})
              </Badge>
              <Badge variant={filterType === "blacklisted" ? "destructive" : "outline"} className="cursor-pointer" onClick={() => setFilterType("blacklisted")}>
                Blacklisted ({blacklistedCount})
              </Badge>
            </div>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading staged data...</p>
          ) : staged.length === 0 ? (
            <p className="text-muted-foreground text-sm">No staged data. Go to "Import Data" tab to upload an Excel file first.</p>
          ) : (
            <div className="overflow-auto max-h-[60vh] border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>UMR</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Visit Date</TableHead>
                    <TableHead>Discount %</TableHead>
                    <TableHead>Net Amt</TableHead>
                    <TableHead>Tag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r: any) => (
                    <TableRow key={r.id} className={r.is_blacklisted ? "bg-destructive/10" : r.is_update ? "bg-accent/30" : ""}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                      </TableCell>
                      <TableCell>
                        {r.is_blacklisted ? (
                          <Badge variant="destructive">Blacklisted</Badge>
                        ) : r.is_update ? (
                          <Badge variant="secondary">Update</Badge>
                        ) : (
                          <Badge variant="default">New</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{r.patient_name || "—"}</TableCell>
                      <TableCell>{r.mobile_number}</TableCell>
                      <TableCell>{r.umr_number || "—"}</TableCell>
                      <TableCell>{r.location || "—"}</TableCell>
                      <TableCell>{r.bill_number || "—"}</TableCell>
                      <TableCell>{r.visit_date || "—"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-16 h-7 text-xs"
                          defaultValue={r.default_discount_pct ?? 20}
                          onBlur={(e) => handleDiscountChange(r.id, e.target.value)}
                        />
                      </TableCell>
                      <TableCell>₹{r.net_amount || 0}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.record_tag || "DAILY"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CRMImportReview;
