import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateAndUploadCard, getTemplateAssets, type CardData } from "@/lib/cardRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Plus, Pencil, Trash2, Eye, Send, Settings, MessageCircle } from "lucide-react";
import { toast } from "sonner";

interface DripFilter {
  id: string;
  name: string;
  message_type: string;
  priority: number;
  location_filter: string;
  last_sent_type_filter: string | null;
  last_sent_days_ago: number;
  record_limit: number;
  template_id: string | null;
  enabled: boolean;
  once_per_mobile: boolean;
  created_at: string;
}

interface PreviewResult {
  filterId: string;
  filterName: string;
  eligible: number;
  skipped: { reason: string; count: number }[];
  records: any[];
}

const MESSAGE_TYPES = [
  { value: "abc_card", label: "ABC Loyalty Card" },
  { value: "abnormal_card", label: "Abnormal History Card" },
  { value: "promotion", label: "Promotion" },
];

const LOCATIONS = ["ALL", "PH VESU", "NON PHPL"];

const SEQUENCE_OPTIONS = [
  { value: "__none__", label: "No sequencing (any)" },
  { value: "ABC", label: "Last sent was ABC" },
  { value: "Abnormal History", label: "Last sent was Abnormal History" },
  { value: "__null__", label: "Never sent before" },
];

const AutomatedMarketing = () => {
  const qc = useQueryClient();

  // Global settings
  const [maxPerDay, setMaxPerDay] = useState(200);
  const [minInterval, setMinInterval] = useState(3);
  const [excludeBlacklist, setExcludeBlacklist] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Filter dialog
  const [filterOpen, setFilterOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<DripFilter | null>(null);
  const [filterForm, setFilterForm] = useState({
    name: "",
    message_type: "abc_card",
    priority: 1,
    location_filter: "ALL",
    last_sent_type_filter: "__none__",
    last_sent_days_ago: 7,
    record_limit: 100,
    template_id: "",
    enabled: true,
    once_per_mobile: false,
  });

  // Execution state
  const [previewing, setPreviewing] = useState(false);
  const [previewResults, setPreviewResults] = useState<PreviewResult[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendPhase, setSendPhase] = useState("");

  // Load global settings
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["drip_max_messages_per_day", "drip_min_interval_days", "drip_exclude_blacklist"]);
      const map: Record<string, string> = {};
      (data || []).forEach((s) => { map[s.setting_key] = s.setting_value; });
      if (map["drip_max_messages_per_day"]) setMaxPerDay(Number(map["drip_max_messages_per_day"]));
      if (map["drip_min_interval_days"]) setMinInterval(Number(map["drip_min_interval_days"]));
      if (map["drip_exclude_blacklist"] === "false") setExcludeBlacklist(false);
      setSettingsLoaded(true);
    })();
  }, []);

  const saveGlobalSetting = async (key: string, value: string) => {
    await supabase.from("app_settings").upsert(
      { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
      { onConflict: "setting_key" }
    );
  };

  // Filters query
  const { data: filters = [], isLoading: filtersLoading } = useQuery({
    queryKey: ["drip-filters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drip_campaign_filters")
        .select("*")
        .order("priority", { ascending: true });
      if (error) throw error;
      return (data || []) as DripFilter[];
    },
  });

  // Marketing templates for promotions
  const { data: marketingTemplates = [] } = useQuery({
    queryKey: ["marketing-templates-list"],
    queryFn: async () => {
      const { data } = await supabase.from("marketing_templates").select("id, template_name").order("template_name");
      return data || [];
    },
  });

  // Loyalty card templates
  const { data: cardTemplates = [] } = useQuery({
    queryKey: ["loyalty_card_templates"],
    queryFn: async () => {
      const { data } = await supabase.from("loyalty_card_templates").select("id, name").order("name");
      return data || [];
    },
  });

  // Abnormal card templates
  const { data: abnormalTemplates = [] } = useQuery({
    queryKey: ["abnormal-card-templates-list"],
    queryFn: async () => {
      const { data } = await supabase.from("abnormal_card_templates").select("id, name").order("name");
      return data || [];
    },
  });

  // Recent logs
  const { data: recentLogs = [] } = useQuery({
    queryKey: ["drip-campaign-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drip_campaign_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const openNewFilter = () => {
    setEditingFilter(null);
    setFilterForm({
      name: "",
      message_type: "abc_card",
      priority: (filters.length + 1),
      location_filter: "ALL",
      last_sent_type_filter: "__none__",
      last_sent_days_ago: 7,
      record_limit: 100,
      template_id: "",
      enabled: true,
      once_per_mobile: false,
    });
    setFilterOpen(true);
  };

  const openEditFilter = (f: DripFilter) => {
    setEditingFilter(f);
    setFilterForm({
      name: f.name,
      message_type: f.message_type,
      priority: f.priority,
      location_filter: f.location_filter,
      last_sent_type_filter: f.last_sent_type_filter || "__none__",
      last_sent_days_ago: f.last_sent_days_ago,
      record_limit: f.record_limit,
      template_id: f.template_id || "",
      enabled: f.enabled,
      once_per_mobile: f.once_per_mobile ?? false,
    });
    setFilterOpen(true);
  };

  const saveFilter = async () => {
    if (!filterForm.name.trim()) return toast.error("Filter name is required");
    const payload = {
      name: filterForm.name.trim(),
      message_type: filterForm.message_type,
      priority: filterForm.priority,
      location_filter: filterForm.location_filter,
      last_sent_type_filter: filterForm.last_sent_type_filter === "__none__" ? null : filterForm.last_sent_type_filter,
      last_sent_days_ago: filterForm.last_sent_days_ago,
      record_limit: filterForm.record_limit,
      template_id: filterForm.template_id || null,
      enabled: filterForm.enabled,
      once_per_mobile: filterForm.once_per_mobile,
    };

    if (editingFilter) {
      const { error } = await supabase.from("drip_campaign_filters").update(payload).eq("id", editingFilter.id);
      if (error) return toast.error("Failed to update filter");
      toast.success("Filter updated");
    } else {
      const { error } = await supabase.from("drip_campaign_filters").insert(payload);
      if (error) return toast.error("Failed to create filter");
      toast.success("Filter created");
    }
    setFilterOpen(false);
    qc.invalidateQueries({ queryKey: ["drip-filters"] });
  };

  const deleteFilter = async (id: string) => {
    const { error } = await supabase.from("drip_campaign_filters").delete().eq("id", id);
    if (error) return toast.error("Failed to delete filter");
    toast.success("Filter deleted");
    qc.invalidateQueries({ queryKey: ["drip-filters"] });
  };

  const toggleFilter = async (id: string, enabled: boolean) => {
    await supabase.from("drip_campaign_filters").update({ enabled }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["drip-filters"] });
  };

  // Core dedup logic: collect eligible records per filter with completion lock + cycle reset
  const collectEligibleRecords = async () => {
    const enabledFilters = filters.filter((f) => f.enabled).sort((a, b) => a.priority - b.priority);
    if (enabledFilters.length === 0) return [];

    const BATCH = 1000;
    const intervalDate = new Date();
    intervalDate.setDate(intervalDate.getDate() - minInterval);

    // Helper to fetch all rows in paginated batches
    const fetchAll = async (query: any) => {
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await query.range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    };

    // Run ALL queries in parallel for speed
    const [allContacts, blacklistData, recentSends, abnormalPks, cyclesData, allLogs] = await Promise.all([
      fetchAll(supabase.from("crm_contacts").select("primary_key,mobile_number,patient_name,umr_number,location,last_sent_date,last_sent_type,record_tag,default_discount_pct,visit_date")),
      excludeBlacklist
        ? supabase.from("crm_blacklist").select("mobile_number").then(r => r.data || [])
        : Promise.resolve([]),
      supabase.from("drip_campaign_log").select("mobile_number").eq("status", "sent").gte("created_at", intervalDate.toISOString()).then(r => r.data || []),
      supabase.from("crm_abnormal_tests").select("contact_primary_key").then(r => r.data || []),
      supabase.from("drip_mobile_cycles").select("mobile_number,current_cycle").then(r => r.data || []),
      fetchAll(supabase.from("drip_campaign_log").select("filter_id,mobile_number,contact_primary_key,cycle_number").eq("status", "sent")),
    ]);

    const blacklistSet = new Set(blacklistData.map((b: any) => b.mobile_number));
    const recentMobiles = new Set(recentSends.map((r: any) => r.mobile_number));
    const abnormalPkSet = new Set(abnormalPks.map((a: any) => a.contact_primary_key));
    const mobileCycles: Record<string, number> = {};
    (cyclesData || []).forEach((c: any) => { mobileCycles[c.mobile_number] = c.current_cycle; });

    // Group contacts by mobile number
    const contactsByMobile: Record<string, any[]> = {};
    for (const c of allContacts) {
      const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
      if (mob && mob.length === 10) {
        if (!contactsByMobile[mob]) contactsByMobile[mob] = [];
        contactsByMobile[mob].push(c);
      }
    }

    // Build sent-log lookup: { mobile -> { filterId -> Set<primary_key> } } for current cycle
    const sentByMobileFilter: Record<string, Record<string, Set<string>>> = {};
    for (const log of allLogs) {
      const mob = log.mobile_number;
      const cycle = log.cycle_number || 1;
      const mobileCycle = mobileCycles[mob] || 1;
      if (cycle !== mobileCycle) continue; // only count current cycle
      if (!sentByMobileFilter[mob]) sentByMobileFilter[mob] = {};
      if (!sentByMobileFilter[mob][log.filter_id]) sentByMobileFilter[mob][log.filter_id] = new Set();
      if (log.contact_primary_key) sentByMobileFilter[mob][log.filter_id].add(log.contact_primary_key);
    }

    // Helper: count how many eligible records a filter has for a mobile
    const getEligibleCount = (filter: DripFilter, mob: string): number => {
      const contacts = contactsByMobile[mob] || [];
      if (filter.once_per_mobile) return 1; // only 1 needed
      // For abc_card: only count contacts with UMR
      if (filter.message_type === "abc_card") {
        return contacts.filter(c => c.umr_number && c.umr_number.trim()).length;
      }
      // For abnormal_card: only count contacts with abnormal history
      if (filter.message_type === "abnormal_card") {
        return contacts.filter(c => abnormalPkSet.has(c.primary_key)).length;
      }
      return contacts.length;
    };

    // Helper: count how many have been sent for a filter+mobile in current cycle
    const getSentCount = (filterId: string, mob: string): number => {
      return sentByMobileFilter[mob]?.[filterId]?.size || 0;
    };

    // Check if a higher-priority filter still has unsent records for this mobile
    // ABC must finish ALL patients before abnormal can start for that mobile
    const isLockedByHigherPriority = (currentFilter: DripFilter, mob: string): boolean => {
      for (const f of enabledFilters) {
        if (f.priority >= currentFilter.priority) break;
        const eligible = getEligibleCount(f, mob);
        const sent = getSentCount(f.id, mob);
        if (sent < eligible) return true; // higher priority not done yet
      }
      return false;
    };

    // Check if ALL filters are complete for a mobile (for cycle reset)
    const allFiltersComplete = (mob: string): boolean => {
      for (const f of enabledFilters) {
        const eligible = getEligibleCount(f, mob);
        const sent = getSentCount(f.id, mob);
        if (sent < eligible) return false;
      }
      return true;
    };

    // Mobiles that need cycle reset
    const mobilesToResetCycle: string[] = [];

    // Claimed mobiles set across all filters (for daily dedup)
    const claimedMobiles = new Set<string>();
    const initialPerFilter = Math.floor(maxPerDay / enabledFilters.length);

    // --- PASS 1: Collect eligible records per filter with initial equal limits ---
    const filterEligibleAll: Map<string, { filter: DripFilter; eligible: any[]; allCandidates: any[]; skips: Record<string, number> }> = new Map();

    const collectForFilter = (filter: DripFilter, limit: number, sharedClaimed: Set<string>) => {
      const eligible: any[] = [];
      const skips: Record<string, number> = {};
      const addSkip = (reason: string) => { skips[reason] = (skips[reason] || 0) + 1; };

      let candidates = allContacts;
      if (filter.location_filter !== "ALL") {
        candidates = candidates.filter((c) => {
          const loc = (c.location || "").trim().toUpperCase();
          return loc === filter.location_filter.toUpperCase();
        });
      }

      if (filter.last_sent_type_filter) {
        if (filter.last_sent_type_filter === "__null__") {
          candidates = candidates.filter((c) => !c.last_sent_type);
        } else {
          candidates = candidates.filter((c) => c.last_sent_type === filter.last_sent_type_filter);
        }
      }

      if (minInterval > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - minInterval);
        candidates = candidates.filter((c) => {
          if (!c.last_sent_date) return true;
          return new Date(c.last_sent_date) < cutoff;
        });
      }

      candidates.sort((a, b) => {
        const aHas = a.last_sent_type ? 1 : 0;
        const bHas = b.last_sent_type ? 1 : 0;
        return aHas - bHas;
      });

      const filterSeenMobiles = new Set<string>();

      for (const c of candidates) {
        if (eligible.length >= limit) break;

        const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (!mob || mob.length !== 10) { addSkip("invalid_mobile"); continue; }

        if (excludeBlacklist && blacklistSet.has(mob)) { addSkip("blacklisted"); continue; }
        if (recentMobiles.has(mob)) { addSkip("interval"); continue; }

        if (c.last_sent_date) {
          const lastSent = new Date(c.last_sent_date);
          const intervalCutoff = new Date();
          intervalCutoff.setDate(intervalCutoff.getDate() - minInterval);
          if (lastSent >= intervalCutoff) { addSkip("interval"); continue; }
        }

        if (sharedClaimed.has(mob)) { addSkip("duplicate"); continue; }
        if (filter.once_per_mobile && filterSeenMobiles.has(mob)) { addSkip("once_per_mobile_dedup"); continue; }

        if (allFiltersComplete(mob) && enabledFilters.length > 0) {
          if (!mobilesToResetCycle.includes(mob)) mobilesToResetCycle.push(mob);
        }

        if (!allFiltersComplete(mob) && isLockedByHigherPriority(filter, mob)) {
          addSkip("completion_lock"); continue;
        }

        const sentForThisFilter = getSentCount(filter.id, mob);
        const eligibleForThisFilter = getEligibleCount(filter, mob);
        if (sentForThisFilter >= eligibleForThisFilter && !allFiltersComplete(mob)) {
          addSkip("already_complete"); continue;
        }

        const currentCycle = mobileCycles[mob] || 1;
        const sentPks = sentByMobileFilter[mob]?.[filter.id];
        if (sentPks && sentPks.has(c.primary_key)) { addSkip("already_sent_this_cycle"); continue; }

        if (filter.message_type === "abc_card") {
          if (!c.umr_number || !c.umr_number.trim()) { addSkip("missing_umr"); continue; }
        }
        if (filter.message_type === "abnormal_card") {
          if (!abnormalPkSet.has(c.primary_key)) { addSkip("no_abnormal_history"); continue; }
        }

        filterSeenMobiles.add(mob);
        sharedClaimed.add(mob);
        eligible.push({ ...c, _cycle: currentCycle });
      }

      return { eligible, candidates, skips };
    };

    // Pass 1: equal distribution
    for (const filter of enabledFilters) {
      const { eligible, candidates, skips } = collectForFilter(filter, initialPerFilter, claimedMobiles);
      filterEligibleAll.set(filter.id, { filter, eligible, allCandidates: candidates, skips });
    }

    // Pass 2: redistribute unused quota to higher-priority filters that need more
    let totalUsed = 0;
    for (const v of filterEligibleAll.values()) totalUsed += v.eligible.length;
    let remaining = maxPerDay - totalUsed;

    if (remaining > 0) {
      for (const filter of enabledFilters) {
        if (remaining <= 0) break;
        const entry = filterEligibleAll.get(filter.id)!;
        // Try to collect more with the remaining quota
        const extra = collectForFilter(filter, entry.eligible.length + remaining, claimedMobiles);
        const newRecords = extra.eligible.filter(
          (r) => !entry.eligible.some((e) => e.primary_key === r.primary_key)
        );
        if (newRecords.length > 0) {
          entry.eligible.push(...newRecords);
          // Merge skip counts
          for (const [reason, count] of Object.entries(extra.skips)) {
            entry.skips[reason] = (entry.skips[reason] || 0) + count;
          }
          remaining -= newRecords.length;
        }
      }
    }

    const results: PreviewResult[] = [];
    for (const filter of enabledFilters) {
      const entry = filterEligibleAll.get(filter.id)!;
      results.push({
        filterId: filter.id,
        filterName: filter.name,
        eligible: entry.eligible.length,
        skipped: Object.entries(entry.skips).map(([reason, count]) => ({ reason, count })),
        records: entry.eligible,
      });
    }

    // Process cycle resets
    for (const mob of mobilesToResetCycle) {
      const currentCycle = mobileCycles[mob] || 1;
      const newCycle = currentCycle + 1;
      await supabase.from("drip_mobile_cycles").upsert(
        { mobile_number: mob, current_cycle: newCycle, updated_at: new Date().toISOString() },
        { onConflict: "mobile_number" }
      );
    }

    return results;
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewResults(null);
    try {
      const results = await collectEligibleRecords();
      setPreviewResults(results);
    } catch (err) {
      console.error(err);
      toast.error("Preview failed");
    }
    setPreviewing(false);
  };

  const handleSend = async () => {
    if (!previewResults || previewResults.every((r) => r.eligible === 0)) {
      return toast.error("Run preview first and ensure there are eligible records");
    }

    const enabledFilters = filters.filter((f) => f.enabled).sort((a, b) => a.priority - b.priority);
    
    // Fetch all WA settings
    const { data: allSettings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .or("setting_key.like.loyalty_wa_%,setting_key.like.abnormal_wa_%,setting_key.eq.crm_abc_static_expiry_date,setting_key.eq.abnormal_static_expiry_date");
    const cfg: Record<string, string> = {};
    (allSettings || []).forEach((s) => { cfg[s.setting_key] = s.setting_value; });

    setSending(true);
    setSendProgress(0);

    const totalMessages = previewResults.reduce((sum, r) => sum + r.eligible, 0);
    let processedCount = 0;
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const preview of previewResults) {
      if (preview.eligible === 0) continue;
      const filter = enabledFilters.find((f) => f.id === preview.filterId);
      if (!filter) continue;

      setSendPhase(`Processing filter: ${filter.name} (${preview.eligible} records)`);

      if (filter.message_type === "abc_card") {
        // Send ABC loyalty cards
        const loyaltyApiBaseUrl = cfg["loyalty_wa_baseUrl"];
        const loyaltyApiKey = cfg["loyalty_wa_apiKey"];
        const loyaltyTemplateName = cfg["loyalty_wa_templateName"];
        const loyaltyAuthHeaderName = cfg["loyalty_wa_authHeaderName"] || "apikey";
        const loyaltyAuthHeaderPrefix = cfg["loyalty_wa_authHeaderPrefix"] || "";
        const loyaltyFromNumber = cfg["loyalty_wa_fromNumber"] || "";
        const loyaltyCampaignName = cfg["loyalty_wa_campaignName"] || "";
        const bodyMappingStr = cfg["loyalty_wa_bodyMapping"];
        const staticExpiryDate = cfg["crm_abc_static_expiry_date"] || "";
        const delayMs = Number(cfg["loyalty_wa_delayMs"]) || 3000;

        if (!loyaltyApiBaseUrl || !loyaltyApiKey || !loyaltyTemplateName) {
          toast.error("Loyalty WhatsApp API not configured");
          for (const c of preview.records) {
            await logDripAction(filter, c, "failed", "wa_not_configured");
            totalFailed++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
          }
          continue;
        }

        let mapping: Record<string, string> = {};
        try { mapping = bodyMappingStr ? JSON.parse(bodyMappingStr) : {}; } catch { mapping = {}; }

        // Use first available card template
        const templateId = filter.template_id || (cardTemplates.length > 0 ? cardTemplates[0].id : null);
        if (!templateId) {
          toast.error("No loyalty card template available for filter: " + filter.name);
          for (const c of preview.records) {
            await logDripAction(filter, c, "failed", "no_template");
            totalFailed++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
          }
          continue;
        }

        let templateAssets: Awaited<ReturnType<typeof getTemplateAssets>>;
        try {
          templateAssets = await getTemplateAssets(templateId);
          if (!templateAssets) throw new Error("Template not found");
        } catch {
          toast.error("Failed to load card template for filter: " + filter.name);
          for (const c of preview.records) {
            await logDripAction(filter, c, "failed", "template_load_error");
            totalFailed++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
          }
          continue;
        }

        const { bgImg, canvas, ctx, placeholders } = templateAssets;

        for (let i = 0; i < preview.records.length; i++) {
          const r = preview.records[i];
          const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
          setSendPhase(`[${filter.name}] Generating & sending ${i + 1}/${preview.eligible}...`);

          const cardData: CardData = {
            Name: r.patient_name || "",
            Mobile: mob,
            UMR: r.umr_number || "",
            "Discount %": `${r.default_discount_pct ?? 20}%`,
            "Expiry Date": staticExpiryDate,
          };

          const imageUrl = await generateAndUploadCard(templateId, cardData, bgImg, canvas, ctx, placeholders);
          if (!imageUrl) {
            await logDripAction(filter, r, "failed", "card_generation_error");
            totalFailed++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
            continue;
          }

          const components: Record<string, unknown> = {};
          if (Object.keys(mapping).length > 0) {
            const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
            const params = sortedKeys.map((key) => {
              const field = mapping[key];
              switch (field) {
                case "Name": return r.patient_name || "";
                case "Mobile": return r.mobile_number || "";
                case "UMR": return r.umr_number || "";
                case "Discount %": return `${r.default_discount_pct ?? 20}%`;
                case "Expiry Date": return staticExpiryDate;
                default: return "";
              }
            });
            components.body = { params };
          }
          components.header = { type: "image", image: { link: imageUrl } };

          const payload: Record<string, unknown> = {
            from: loyaltyFromNumber,
            to: `+91${mob}`,
            templateName: loyaltyTemplateName,
            campaignName: loyaltyCampaignName,
            type: "template",
          };
          if (Object.keys(components).length > 0) payload.components = components;

          try {
            const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
              body: { apiBaseUrl: loyaltyApiBaseUrl, apiKey: loyaltyApiKey, authHeaderName: loyaltyAuthHeaderName, authHeaderPrefix: loyaltyAuthHeaderPrefix, payload },
            });
            if (proxyRes.error || proxyRes.data?.status >= 400) {
              await logDripAction(filter, r, "failed", "wa_api_error");
              totalFailed++;
            } else {
              await logDripAction(filter, r, "sent");
              await supabase.from("crm_contacts").update({
                last_sent_type: "ABC",
                last_sent_date: new Date().toISOString(),
                record_tag: null,
              }).eq("id", r.id);
              totalSent++;
            }
          } catch {
            await logDripAction(filter, r, "failed", "wa_exception");
            totalFailed++;
          }

          processedCount++;
          setSendProgress(Math.round((processedCount / totalMessages) * 100));
          if (delayMs > 0 && i < preview.records.length - 1) {
            await new Promise((res) => setTimeout(res, delayMs));
          }
        }

      } else if (filter.message_type === "abnormal_card") {
        // Send Abnormal History cards
        const abnormalApiBaseUrl = cfg["abnormal_wa_baseUrl"];
        const abnormalApiKey = cfg["abnormal_wa_apiKey"];
        const abnormalTemplateName = cfg["abnormal_wa_templateName"];
        const abnormalAuthHeaderName = cfg["abnormal_wa_authHeaderName"] || "apikey";
        const abnormalAuthHeaderPrefix = cfg["abnormal_wa_authHeaderPrefix"] || "";
        const abnormalFromNumber = cfg["abnormal_wa_fromNumber"] || "";
        const abnormalCampaignName = cfg["abnormal_wa_campaignName"] || "";
        const includeMediaHeader = cfg["abnormal_wa_mediaHeader"] !== "false";
        const delayMs = Number(cfg["abnormal_wa_delayMs"]) || 3000;
        const staticExpiryDate = cfg["abnormal_static_expiry_date"] || "";

        if (!abnormalApiBaseUrl || !abnormalApiKey || !abnormalTemplateName) {
          toast.error("Abnormal WhatsApp API not configured");
          for (const c of preview.records) {
            await logDripAction(filter, c, "failed", "wa_not_configured");
            totalFailed++;
            processedCount++;
          }
          setSendProgress(Math.round((processedCount / totalMessages) * 100));
          continue;
        }

        // Fetch abnormal card template
        const abnTemplateId = filter.template_id || (abnormalTemplates.length > 0 ? abnormalTemplates[0].id : null);
        let abnTemplate: any = null;
        if (abnTemplateId) {
          const { data } = await supabase.from("abnormal_card_templates").select("*").eq("id", abnTemplateId).single();
          abnTemplate = data;
        }

        for (let i = 0; i < preview.records.length; i++) {
          const r = preview.records[i];
          const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
          setSendPhase(`[${filter.name}] Processing ${i + 1}/${preview.eligible}...`);

          // Fetch abnormal tests for this contact
          const { data: tests } = await supabase
            .from("crm_abnormal_tests")
            .select("*")
            .eq("contact_primary_key", r.primary_key)
            .order("test_name");

          if (!tests || tests.length === 0) {
            await logDripAction(filter, r, "skipped", "no_abnormal_history");
            totalSkipped++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
            continue;
          }

          // Generate abnormal card image (simplified - use template if available)
          const imageResult = await generateAbnormalCardForDrip(r, tests, abnTemplate, staticExpiryDate);
          if (!imageResult) {
            await logDripAction(filter, r, "failed", "card_generation_error");
            totalFailed++;
            processedCount++;
            setSendProgress(Math.round((processedCount / totalMessages) * 100));
            continue;
          }

          const components: Record<string, unknown> = {};
          if (includeMediaHeader) {
            components.header = { type: "image", image: { link: imageResult } };
          }
          components.body = { params: [(r.patient_name || "").toUpperCase()] };

          const payload: Record<string, unknown> = {
            from: abnormalFromNumber,
            to: `+91${mob}`,
            templateName: abnormalTemplateName,
            campaignName: abnormalCampaignName,
            type: "template",
            components,
          };

          try {
            const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
              body: { apiBaseUrl: abnormalApiBaseUrl, apiKey: abnormalApiKey, authHeaderName: abnormalAuthHeaderName, authHeaderPrefix: abnormalAuthHeaderPrefix, payload },
            });
            if (proxyRes.error || proxyRes.data?.status >= 400) {
              await logDripAction(filter, r, "failed", "wa_api_error");
              totalFailed++;
            } else {
              await logDripAction(filter, r, "sent");
              await supabase.from("crm_contacts").update({
                last_sent_type: "Abnormal History",
                last_sent_date: new Date().toISOString(),
              }).eq("id", r.id);
              totalSent++;
            }
          } catch {
            await logDripAction(filter, r, "failed", "wa_exception");
            totalFailed++;
          }

          processedCount++;
          setSendProgress(Math.round((processedCount / totalMessages) * 100));
          if (delayMs > 0 && i < preview.records.length - 1) {
            await new Promise((res) => setTimeout(res, delayMs));
          }
        }

      } else if (filter.message_type === "promotion") {
        // Send promotion via marketing template
        if (!filter.template_id) {
          toast.error("No marketing template selected for filter: " + filter.name);
          for (const c of preview.records) {
            await logDripAction(filter, c, "failed", "no_template");
            totalFailed++;
            processedCount++;
          }
          setSendProgress(Math.round((processedCount / totalMessages) * 100));
          continue;
        }

        const { data: tmpl } = await supabase.from("marketing_templates").select("*").eq("id", filter.template_id).single();
        if (!tmpl) {
          toast.error("Marketing template not found for filter: " + filter.name);
          continue;
        }

        const delayMs = 3000;

        for (let i = 0; i < preview.records.length; i++) {
          const r = preview.records[i];
          const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
          setSendPhase(`[${filter.name}] Sending promo ${i + 1}/${preview.eligible}...`);

          const toNumber = `+91${mob}`;
          const payload: Record<string, unknown> = {
            from: tmpl.from_number || "",
            to: toNumber,
            templateName: tmpl.whatsapp_template_name,
            type: "template",
          };

          // Parse body mapping
          let bodyMapping: Record<string, string> = {};
          try { bodyMapping = tmpl.body_mapping ? JSON.parse(tmpl.body_mapping) : {}; } catch { bodyMapping = {}; }

          if (Object.keys(bodyMapping).length > 0) {
            const sortedKeys = Object.keys(bodyMapping).sort((a, b) => Number(a) - Number(b));
            const params = sortedKeys.map((key) => {
              const field = bodyMapping[key];
              switch (field) {
                case "Name": return r.patient_name || "";
                case "Mobile": return r.mobile_number || "";
                default: return field || "";
              }
            });
            payload.components = { body: { params } };
          }

          try {
            const proxyRes = await supabase.functions.invoke("send-marketing-message", {
              body: {
                apiUrl: tmpl.api_base_url,
                apiKey: tmpl.api_key,
                headerName: tmpl.auth_header_name,
                headerPrefix: tmpl.auth_header_prefix,
                payload,
              },
            });
            if (proxyRes.error || proxyRes.data?.status >= 400) {
              await logDripAction(filter, r, "failed", "wa_api_error");
              totalFailed++;
            } else {
              await logDripAction(filter, r, "sent");
              await supabase.from("crm_contacts").update({
                last_sent_type: "Promotion",
                last_sent_date: new Date().toISOString(),
              }).eq("id", r.id);
              totalSent++;
            }
          } catch {
            await logDripAction(filter, r, "failed", "wa_exception");
            totalFailed++;
          }

          processedCount++;
          setSendProgress(Math.round((processedCount / totalMessages) * 100));
          if (delayMs > 0 && i < preview.records.length - 1) {
            await new Promise((res) => setTimeout(res, delayMs));
          }
        }
      }
    }

    setSending(false);
    setSendPhase("");
    setPreviewResults(null);
    qc.invalidateQueries({ queryKey: ["drip-campaign-logs"] });
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    toast.success(`Campaign complete! Sent: ${totalSent}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);
  };

  const logDripAction = async (filter: DripFilter, contact: any, status: string, skipReason?: string) => {
    const mob = (contact.mobile_number || "").replace(/\D/g, "").slice(-10);
    const cycleNum = contact._cycle || 1;
    await supabase.from("drip_campaign_log").insert({
      filter_id: filter.id,
      filter_name: filter.name,
      message_type: filter.message_type,
      mobile_number: mob,
      patient_name: contact.patient_name || "",
      contact_primary_key: contact.primary_key || "",
      status,
      skip_reason: skipReason || null,
      cycle_number: cycleNum,
    });
  };

  // Simplified abnormal card generator for drip campaigns
  const generateAbnormalCardForDrip = async (contact: any, tests: any[], template: any, expiryDate: string): Promise<string | null> => {
    try {
      const cw = template?.canvas_width || 900;
      const padding = 30;
      const tRowHeight = (template?.table_config as any)?.rowHeight || 35;
      const tableHeaderH = (template?.table_config as any)?.headerHeight || 40;
      const hdrH = template?.show_header_band !== false ? (template?.header_band_height || 160) : 0;

      const bandsArr = Array.isArray(template?.bands) ? template.bands : [];
      const bandsAboveH = bandsArr.filter((b: any) => b.position === "above-table").reduce((s: number, b: any) => s + (b.height || 40), 0);
      const bandsBelowH = bandsArr.filter((b: any) => b.position === "below-table").reduce((s: number, b: any) => s + (b.height || 40), 0);
      const footerLinesArr = Array.isArray(template?.footer_lines) ? template.footer_lines : [];
      const footerH = footerLinesArr.reduce((s: number, fl: any) => s + (fl.fontSize || 12) + 8, 0);

      const height = hdrH + bandsAboveH + 10 + tableHeaderH + tests.length * tRowHeight + 10 + bandsBelowH + footerH + 40;

      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const bgColor = template?.background_color || "#FFFFFF";
      const headerBg = template?.header_bg_color || "#2E3192";
      const headerFontCol = template?.header_font_color || "#FFFFFF";

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, cw, height);

      if (template?.show_header_band !== false) {
        ctx.fillStyle = headerBg;
        ctx.fillRect(0, 0, cw, hdrH);
      }

      // Logo
      if (template?.logo_url) {
        try {
          const response = await fetch(template.logo_url);
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject();
            img.src = dataUrl;
          });
          const lx = ((template.logo_x ?? 2) / 100) * cw;
          const ly = ((template.logo_y ?? 2) / 100) * hdrH;
          ctx.drawImage(logoImg, lx, ly, template.logo_width || 120, template.logo_height || 60);
        } catch {}
      }

      // Table config
      const tc = (template?.table_config || {}) as any;
      const tHeaderBg = tc.headerBgColor || "#2E3192";
      const tHeaderFontColor = tc.headerFontColor || "#FFFFFF";
      const tHeaderFontSize = tc.headerFontSize || 14;
      const tRowFontSize = tc.rowFontSize || 13;
      const tRowFontColor = tc.rowFontColor || "#333333";
      const tResultColor = tc.resultColor || "#CC0000";
      const tAltRowColor = tc.altRowColor || "#F5F5F5";
      const tBorderColor = tc.borderColor || "#DDDDDD";
      const colWidths = tc.colWidths || [0.35, 0.18, 0.17, 0.30];

      // Bands above table
      let cursorY = hdrH;
      bandsArr.filter((b: any) => b.position === "above-table").forEach((b: any) => {
        ctx.fillStyle = b.color || "#2E3192";
        ctx.fillRect(0, cursorY, cw, b.height || 40);
        if (b.text) {
          ctx.fillStyle = b.textColor || "#FFFFFF";
          ctx.font = `${b.bold ? "bold " : ""}${b.fontSize || 14}px Arial, sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = b.align === "center" ? "center" : b.align === "right" ? "right" : "left";
          const tx = b.align === "center" ? cw / 2 : b.align === "right" ? cw - padding : padding;
          ctx.fillText(b.text, tx, cursorY + (b.height || 40) / 2);
        }
        cursorY += b.height || 40;
      });

      // Table
      const tableY = cursorY + 10;
      const tableW = cw - padding * 2;
      const colStarts = [0, colWidths[0], colWidths[0] + colWidths[1], colWidths[0] + colWidths[1] + colWidths[2]].map(
        (f) => padding + f * tableW + 10
      );
      const colEnds = [...colStarts.slice(1), padding + tableW];
      const colMaxWidths = colStarts.map((s, i) => colEnds[i] - s - 6);

      // Helper for auto-shrinking text
      const fillTextFit = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, font: string, minScale = 0.6, align = "left") => {
        const baseSizeMatch = font.match(/(\d+)px/);
        const baseSize = baseSizeMatch ? parseInt(baseSizeMatch[1]) : 14;
        let scale = 1;
        while (scale >= minScale) {
          ctx.font = font.replace(`${baseSize}px`, `${Math.round(baseSize * scale)}px`);
          const m = ctx.measureText(text);
          if (m.width <= maxW) break;
          scale -= 0.05;
        }
        if (scale < minScale) {
          ctx.font = font.replace(`${baseSize}px`, `${Math.round(baseSize * minScale)}px`);
        }
        if (align === "center") {
          const tw = ctx.measureText(text).width;
          ctx.textAlign = "left";
          ctx.fillText(text, x + (maxW - tw) / 2, y);
        } else {
          ctx.textAlign = "left";
          ctx.fillText(text, x, y);
        }
      };

      // Table header
      ctx.fillStyle = tHeaderBg;
      ctx.fillRect(padding, tableY, tableW, tableHeaderH);
      ctx.fillStyle = tHeaderFontColor;
      ctx.textBaseline = "middle";
      const hdrFont = `bold ${tHeaderFontSize}px Arial, sans-serif`;
      const hdrMid = tableY + tableHeaderH / 2;
      fillTextFit(ctx, "Test Name", colStarts[0], hdrMid, colMaxWidths[0], hdrFont, 0.6, "center");
      fillTextFit(ctx, "Date", colStarts[1], hdrMid, colMaxWidths[1], hdrFont, 0.6, "center");
      fillTextFit(ctx, "Result", colStarts[2], hdrMid, colMaxWidths[2], hdrFont, 0.6, "center");
      fillTextFit(ctx, "Normal Range", colStarts[3], hdrMid, colMaxWidths[3], hdrFont, 0.6, "center");

      // Table rows
      tests.forEach((t, i) => {
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
        ctx.textBaseline = "middle";
        const rowFont = `${tRowFontSize}px Arial, sans-serif`;
        const rowMid = y + tRowHeight / 2;
        fillTextFit(ctx, t.test_name || "", colStarts[0], rowMid, colMaxWidths[0], rowFont);
        fillTextFit(ctx, t.test_date || "", colStarts[1], rowMid, colMaxWidths[1], rowFont, 0.6, "center");

        ctx.fillStyle = tResultColor;
        const boldRowFont = `bold ${tRowFontSize}px Arial, sans-serif`;
        fillTextFit(ctx, t.result_value || "", colStarts[2], rowMid, colMaxWidths[2], boldRowFont, 0.6, "center");

        ctx.fillStyle = tRowFontColor;
        fillTextFit(ctx, t.normal_range || "", colStarts[3], rowMid, colMaxWidths[3], rowFont);
      });

      // Table border
      ctx.strokeStyle = tHeaderBg;
      ctx.lineWidth = 2;
      ctx.strokeRect(padding, tableY, tableW, tableHeaderH + tests.length * tRowHeight);

      // Bands below table
      let belowY = tableY + tableHeaderH + tests.length * tRowHeight + 10;
      bandsArr.filter((b: any) => b.position === "below-table").forEach((b: any) => {
        ctx.fillStyle = b.color || "#2E3192";
        ctx.fillRect(0, belowY, cw, b.height || 40);
        if (b.text) {
          ctx.fillStyle = b.textColor || "#FFFFFF";
          ctx.font = `${b.bold ? "bold " : ""}${b.fontSize || 14}px Arial, sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = b.align === "center" ? "center" : b.align === "right" ? "right" : "left";
          const tx = b.align === "center" ? cw / 2 : b.align === "right" ? cw - padding : padding;
          ctx.fillText(b.text, tx, belowY + (b.height || 40) / 2);
        }
        belowY += b.height || 40;
      });

      // Footer
      let fy = belowY + 10;
      footerLinesArr.forEach((fl: any) => {
        ctx.fillStyle = fl.fontColor || "#666666";
        ctx.font = `${fl.bold ? "bold " : ""}${fl.fontSize || 12}px Arial, sans-serif`;
        ctx.textAlign = fl.align === "center" ? "center" : fl.align === "right" ? "right" : "left";
        const fx = fl.align === "center" ? cw / 2 : fl.align === "right" ? cw - padding : padding;
        ctx.fillText(fl.text || "", fx, fy);
        fy += (fl.fontSize || 12) + 8;
      });

      // Placeholders
      const phs: any[] = template?.placeholders ? (typeof template.placeholders === "string" ? JSON.parse(template.placeholders) : template.placeholders) : [];
      const designerSampleRows = 3;
      const rowDiff = (tests.length - designerSampleRows) * tRowHeight;
      const designerTableEndY = hdrH + bandsAboveH + tableHeaderH + designerSampleRows * tRowHeight;

      // Barcode helper
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

      const drawBarcodeOnCanvas = (ctx: CanvasRenderingContext2D, value: string, x: number, y: number, bHeight: number, color: string) => {
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
        const targetWidth = Math.max(evenDigits.length * bHeight * 0.38, bHeight * 2.8);
        const moduleWidth = targetWidth / totalModules;
        ctx.save();
        ctx.fillStyle = color;
        let cursorX2 = x;
        for (const pattern of patterns) {
          pattern.split("").forEach((seg, idx) => {
            const width = Number(seg) * moduleWidth;
            if (idx % 2 === 0) ctx.fillRect(cursorX2, y, width, bHeight);
            cursorX2 += width;
          });
        }
        ctx.restore();
      };

      if (phs.length > 0) {
        for (const p of phs) {
          const px = (p.x / 100) * cw;
          let py = p.y;
          if (py > designerTableEndY) py += rowDiff;
          if (p.field === "Barcode") {
            drawBarcodeOnCanvas(ctx, contact.mobile_number || "", px, py, p.fontSize || 20, p.fontColor || headerFontCol);
          } else {
            ctx.font = `${p.bold ? "bold " : ""}${p.fontSize || 18}px Arial, Helvetica, sans-serif`;
            ctx.fillStyle = p.fontColor || headerFontCol;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            const val = p.field === "Name" ? (contact.patient_name || "").toUpperCase()
              : p.field === "Mobile" ? `Mobile: ${contact.mobile_number || ""}`
              : p.field === "Expiry Date" ? expiryDate
              : `UMR: ${contact.umr_number || ""}`;
            ctx.fillText(val, px, py);
          }
        }
      } else {
        ctx.fillStyle = headerFontCol;
        ctx.font = "bold 28px Arial, Helvetica, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("Abnormal Test History", padding, 20);
        ctx.font = "18px Arial, Helvetica, sans-serif";
        ctx.fillText(`Name: ${(contact.patient_name || "").toUpperCase()}`, padding, 60);
        ctx.fillText(`Mobile: ${contact.mobile_number || ""}`, padding, 88);
        ctx.fillText(`UMR: ${contact.umr_number || ""}`, padding + 400, 88);
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });

      const fileName = `generated/abnormal/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const { error: uploadError } = await supabase.storage.from("loyalty-cards").upload(fileName, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (err) {
      console.error("Drip abnormal card generation failed:", err);
      return null;
    }
  };

  // Group logs by date
  const logsByDate = recentLogs.reduce((acc: Record<string, any[]>, log: any) => {
    const date = new Date(log.created_at).toLocaleDateString("en-GB");
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});

  const skipReasonLabel = (r: string) => {
    const labels: Record<string, string> = {
      blacklisted: "Blacklisted",
      interval: "Min Interval",
      duplicate: "Duplicate Mobile",
      once_per_mobile_dedup: "Once Per Mobile",
      missing_umr: "Missing UMR",
      no_abnormal_history: "No Abnormal History",
      invalid_mobile: "Invalid Mobile",
      wa_not_configured: "WA Not Configured",
      wa_api_error: "WA API Error",
      wa_exception: "WA Exception",
      card_generation_error: "Card Generation Error",
      no_template: "No Template",
      template_load_error: "Template Load Error",
      completion_lock: "Locked by Higher Priority",
      already_complete: "Already Complete (this cycle)",
      already_sent_this_cycle: "Already Sent (this cycle)",
    };
    return labels[r] || r;
  };

  return (
    <div className="space-y-6">
      {/* Progress */}
      {sending && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
          <p className="text-sm font-medium">{sendPhase}</p>
          <Progress value={sendProgress} />
          <p className="text-xs text-muted-foreground">{sendProgress}% complete</p>
        </div>
      )}

      {/* Global Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Global Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Max Messages / Day</Label>
              <Input
                type="number"
                value={maxPerDay}
                onChange={(e) => {
                  const v = Number(e.target.value) || 200;
                  setMaxPerDay(v);
                  saveGlobalSetting("drip_max_messages_per_day", String(v));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Min Gap Between Messages (days)</Label>
              <Input
                type="number"
                value={minInterval}
                onChange={(e) => {
                  const v = Number(e.target.value) || 3;
                  setMinInterval(v);
                  saveGlobalSetting("drip_min_interval_days", String(v));
                }}
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Switch
                checked={excludeBlacklist}
                onCheckedChange={(v) => {
                  setExcludeBlacklist(v);
                  saveGlobalSetting("drip_exclude_blacklist", String(v));
                }}
              />
              <Label>Exclude Blacklisted Numbers</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Campaign Filters</CardTitle>
            <Button size="sm" onClick={openNewFilter}>
              <Plus className="h-4 w-4 mr-1" /> Add Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No filters created yet. Add your first campaign filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Sequencing</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filters.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {MESSAGE_TYPES.find((t) => t.value === f.message_type)?.label || f.message_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{f.priority}</TableCell>
                    <TableCell>{f.location_filter}</TableCell>
                    <TableCell className="text-xs">
                      {f.last_sent_type_filter
                        ? SEQUENCE_OPTIONS.find((s) => s.value === f.last_sent_type_filter)?.label || f.last_sent_type_filter
                        : "Any"}
                    </TableCell>
                    <TableCell>
                      <Switch checked={f.enabled} onCheckedChange={(v) => toggleFilter(f.id, v)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditFilter(f)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteFilter(f.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {filters.some((f) => f.enabled) && (
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={handlePreview} disabled={previewing || sending}>
                <Eye className="h-4 w-4 mr-1" />
                {previewing ? "Previewing..." : "Preview Eligible Records"}
              </Button>
              <Button onClick={handleSend} disabled={sending || !previewResults}>
                <Send className="h-4 w-4 mr-1" />
                Send Messages
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Results */}
      {previewResults && (
        <Card>
          <CardHeader>
            <CardTitle>Preview Results (Limit: {Math.floor(maxPerDay / Math.max(filters.filter(f => f.enabled).length, 1))} per filter)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {previewResults.map((pr) => (
                <div key={pr.filterId} className="border rounded-lg">
                  <div className="flex items-center justify-between p-3 bg-muted/30">
                    <span className="font-medium">{pr.filterName}</span>
                    <div className="flex gap-2">
                      <Badge variant={pr.eligible > 0 ? "default" : "secondary"}>
                        {pr.eligible} eligible
                      </Badge>
                      {pr.skipped.length > 0 && pr.skipped.map((s) => (
                        <Badge key={s.reason} variant="outline" className="text-xs">
                          {skipReasonLabel(s.reason)}: {s.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {pr.records.length > 0 && (
                    <div className="max-h-60 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">#</TableHead>
                            <TableHead className="text-xs">Patient Name</TableHead>
                            <TableHead className="text-xs">Mobile</TableHead>
                            <TableHead className="text-xs">UMR</TableHead>
                            <TableHead className="text-xs">Location</TableHead>
                            <TableHead className="text-xs">Last Sent</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pr.records.map((r: any, idx: number) => (
                            <TableRow key={r.id || idx}>
                              <TableCell className="text-xs">{idx + 1}</TableCell>
                              <TableCell className="text-xs">{r.patient_name || "-"}</TableCell>
                              <TableCell className="text-xs">{r.mobile_number || "-"}</TableCell>
                              <TableCell className="text-xs">{r.umr_number || "-"}</TableCell>
                              <TableCell className="text-xs">{r.location || "-"}</TableCell>
                              <TableCell className="text-xs">
                                {r.last_sent_type ? `${r.last_sent_type} (${r.last_sent_date ? new Date(r.last_sent_date).toLocaleDateString("en-GB") : "-"})` : "Never"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
              <div className="text-sm font-medium pt-2">
                Total messages to send: {previewResults.reduce((s, r) => s + r.eligible, 0)}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution Log */}
      <Card>
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(logsByDate).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No campaign executions yet.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(logsByDate).slice(0, 7).map(([date, logs]) => {
                const sent = logs.filter((l: any) => l.status === "sent").length;
                const failed = logs.filter((l: any) => l.status === "failed").length;
                const skipped = logs.filter((l: any) => l.status === "skipped").length;
                const byFilter = logs.reduce((acc: Record<string, any[]>, l: any) => {
                  const key = l.filter_name || "Unknown";
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(l);
                  return acc;
                }, {});

                return (
                  <div key={date} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{date}</span>
                      <div className="flex gap-2">
                        <Badge variant="default">{sent} sent</Badge>
                        {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
                        {skipped > 0 && <Badge variant="secondary">{skipped} skipped</Badge>}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {Object.entries(byFilter).map(([filterName, filterLogs]: [string, any[]]) => (
                        <div key={filterName} className="text-xs p-2 bg-muted/50 rounded">
                          <span className="font-medium">{filterName}:</span>{" "}
                          {filterLogs.filter((l: any) => l.status === "sent").length} sent,{" "}
                          {filterLogs.filter((l: any) => l.status === "failed").length} failed
                          {filterLogs.some((l: any) => l.skip_reason) && (
                            <span className="text-muted-foreground">
                              {" "}| Skips:{" "}
                              {[...new Set(filterLogs.filter((l: any) => l.skip_reason).map((l: any) => l.skip_reason))].map(
                                (r) => skipReasonLabel(r as string)
                              ).join(", ")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter Dialog */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFilter ? "Edit Filter" : "New Campaign Filter"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Filter Name</Label>
              <Input
                value={filterForm.name}
                onChange={(e) => setFilterForm({ ...filterForm, name: e.target.value })}
                placeholder="e.g. ABC Cards - PH VESU"
              />
            </div>
            <div className="space-y-1">
              <Label>Message Type</Label>
              <Select value={filterForm.message_type} onValueChange={(v) => setFilterForm({ ...filterForm, message_type: v, once_per_mobile: v === "promotion" ? true : filterForm.once_per_mobile })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESSAGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority (lower = first)</Label>
              <Input
                type="number"
                value={filterForm.priority}
                onChange={(e) => setFilterForm({ ...filterForm, priority: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-1">
              <Label>Location Filter</Label>
              <Select value={filterForm.location_filter} onValueChange={(v) => setFilterForm({ ...filterForm, location_filter: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sequencing (Last Sent Type)</Label>
              <Select value={filterForm.last_sent_type_filter} onValueChange={(v) => setFilterForm({ ...filterForm, last_sent_type_filter: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEQUENCE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterForm.message_type === "abc_card" && (
              <div className="space-y-1">
                <Label>Loyalty Card Template</Label>
                <Select value={filterForm.template_id} onValueChange={(v) => setFilterForm({ ...filterForm, template_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {cardTemplates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterForm.message_type === "abnormal_card" && (
              <div className="space-y-1">
                <Label>Abnormal Card Template</Label>
                <Select value={filterForm.template_id} onValueChange={(v) => setFilterForm({ ...filterForm, template_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {abnormalTemplates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterForm.message_type === "promotion" && (
              <div className="space-y-1">
                <Label>Marketing Template</Label>
                <Select value={filterForm.template_id} onValueChange={(v) => setFilterForm({ ...filterForm, template_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {marketingTemplates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch
                checked={filterForm.once_per_mobile}
                onCheckedChange={(v) => setFilterForm({ ...filterForm, once_per_mobile: v })}
              />
              <Label>Send once per mobile</Label>
              <span className="text-xs text-muted-foreground">(skip duplicate mobiles within this filter)</span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={filterForm.enabled}
                onCheckedChange={(v) => setFilterForm({ ...filterForm, enabled: v })}
              />
              <Label>Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilterOpen(false)}>Cancel</Button>
            <Button onClick={saveFilter}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutomatedMarketing;
