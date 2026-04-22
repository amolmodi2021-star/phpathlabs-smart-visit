import { useState, useEffect, useCallback, useRef } from "react";
import { logMessageSend, extractMessageId } from "@/lib/messageLog";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateAndUploadCard, generateAndUploadCardEx, getTemplateAssets, type CardData } from "@/lib/cardRenderer";
import { generateAbnormalCardForDrip as _sharedGenerateAbnormalCardForDrip, generateAbnormalCardForDripEx } from "@/lib/dripCardSenders";
import { makeTokenBucket, sleepResilient } from "@/lib/marketingDelay";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Eye, Send, Settings, MessageCircle, Download, AlertTriangle, FlaskConical, CreditCard, Activity, RefreshCw } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { sortAbnormalTestsByDateDesc } from "@/lib/abnormalTests";
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

// Module-level state so the in-progress send survives component unmount/remount
// (e.g. user navigates between tabs) — sending still stops if the BROWSER tab is closed.
let _moduleAbort = false;
let _moduleSending = false;
let _modulePaused = false;
let _moduleProgress = 0;
let _modulePhase = "";

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
  const [waLimit, setWaLimit] = useState(250);
  const [sentLast24h, setSentLast24h] = useState(0);
  const [countLoading, setCountLoading] = useState(true);

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
  const [sending, setSending] = useState(_moduleSending);
  const [paused, setPaused] = useState(_modulePaused);
  const [sendProgress, setSendProgress] = useState(_moduleProgress);
  const [sendPhase, setSendPhase] = useState(_modulePhase);
  const abortRef = useRef(_moduleAbort);

  // Realtime sync — DISABLED while a campaign is sending. Each WhatsApp send
  // writes one row to message_send_log; broadcasting that to every open tab
  // during a 2K-card run was the single biggest realtime cost driver. Counters
  // get a fresh pull when the run finishes (qc.invalidateQueries in the loop).
  useRealtimeSync(
    "message_send_log",
    ["drip-pending-counts", "wa-usage-24h"],
    400,
    { enabled: !sending },
  );

  // Sync module-level vars on mount
  useEffect(() => {
    if (_moduleSending) {
      setSending(true);
      setSendProgress(_moduleProgress);
      setSendPhase(_modulePhase);
    }
    // Poll module-level state while sending
    const interval = setInterval(() => {
      if (_moduleSending) {
        setSending(true);
        setPaused(_modulePaused);
        setSendProgress(_moduleProgress);
        setSendPhase(_modulePhase);
      } else {
        setSending(false);
        setPaused(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Browser-close warning: while a campaign is sending, prompt the user before
  // they close/refresh/navigate away (closing the tab WILL stop the run).
  useEffect(() => {
    if (!sending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Sending is in progress. Closing this tab will stop the campaign. Are you sure?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sending]);

  // Tab-backgrounded warning: browsers throttle setTimeout in background tabs,
  // which can stall the send loop. Warn the user every time the tab is hidden
  // during an active campaign so they keep this tab in the foreground.
  useEffect(() => {
    if (!sending) return;
    const onVis = () => {
      if (document.hidden && _moduleSending) {
        toast.warning(
          "Keep this tab in the foreground while sending. Background tabs slow down or stall the campaign.",
          { duration: 8000 }
        );
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sending]);

  // Test mode
  const [testMobile, setTestMobile] = useState("");
  const isTrialMode = /^\d{10}$/.test(testMobile.replace(/\D/g, ""));

  // Load global settings
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["drip_max_messages_per_day", "drip_min_interval_days", "drip_exclude_blacklist", "wa_daily_limit"]);
      const map: Record<string, string> = {};
      (data || []).forEach((s) => { map[s.setting_key] = s.setting_value; });
      if (map["drip_max_messages_per_day"]) setMaxPerDay(Number(map["drip_max_messages_per_day"]));
      if (map["drip_min_interval_days"]) setMinInterval(Number(map["drip_min_interval_days"]));
      if (map["drip_exclude_blacklist"] === "false") setExcludeBlacklist(false);
      if (map["wa_daily_limit"]) setWaLimit(Number(map["wa_daily_limit"]));
      setSettingsLoaded(true);
    })();
  }, []);

  // Count messages sent in last 24 hours across all modules
  const fetchSentCount = useCallback(async () => {
    setCountLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const res = await supabase
      .from("message_send_log")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", since);

    const total = res.count || 0;
    setSentLast24h(total);
    setCountLoading(false);
  }, []);

  // Initial fetch only — no auto-refresh. The user clicks Refresh on the
  // counter card when they want a fresh number. Realtime broadcast invalidation
  // is also off (see useRealtimeSync below) to avoid fan-out during campaigns.
  useEffect(() => {
    fetchSentCount();
  }, [fetchSentCount]);

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

  // Recent logs — narrowed to the columns the UI actually uses, capped at 500
  // rows (the diagnostic display only shows the most recent ~7 days grouped).
  // Manual-refresh only via the Execution Log card's Refresh button.
  const { data: recentLogs = [], isFetching: logsFetching, refetch: refetchLogs } = useQuery({
    queryKey: ["drip-campaign-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drip_campaign_log")
        .select("id, status, message_type, mobile_number, contact_primary_key, filter_id, filter_name, cycle_number, skip_reason, created_at, patient_name")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Hidden shadow-comparison toggle: append ?debug=preflight to the URL to enable.
  // When on, the RPC `get_drip_pending_summary` runs alongside the JS preflight
  // and a diff panel is rendered. The JS result remains the source of truth.
  const debugPreflight = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "preflight";

  // Pending counters for ABC cards and Abnormal History — manual refresh only.
  // Was auto-refetching every 2 min and pulling ~100K rows each time.
  const { data: pendingCounts, isLoading: pendingLoading, isFetching: pendingFetching, refetch: refetchPending } = useQuery({
    queryKey: ["drip-pending-counts", filters.map(f => f.id).join(","), excludeBlacklist],
    enabled: filters.length > 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const enabledFilters = filters.filter(f => f.enabled).sort((a, b) => a.priority - b.priority);
      if (enabledFilters.length === 0) return { pendingAbc: 0, pendingAbnormal: 0 };

      const BATCH = 1000;
      const fetchAllPg = async (query: any) => {
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

      const [allContacts, abnormalPks, cyclesData, allLogs, blacklistData] = await Promise.all([
        fetchAllPg(supabase.from("crm_contacts").select("primary_key,mobile_number,umr_number,patient_name,last_sent_type,last_sent_date")),
        fetchAllPg(supabase.from("crm_abnormal_tests").select("contact_primary_key")),
        fetchAllPg(supabase.from("drip_mobile_cycles").select("mobile_number,current_cycle")),
        fetchAllPg(supabase.from("drip_campaign_log").select("filter_id,mobile_number,contact_primary_key,cycle_number").eq("status", "sent")),
        excludeBlacklist
          ? supabase.from("crm_blacklist").select("mobile_number").then(r => r.data || [])
          : Promise.resolve([]),
      ]);

      const blacklistSet = new Set(blacklistData.map((b: any) => b.mobile_number));
      const abnormalPkSet = new Set(abnormalPks.map((a: any) => a.contact_primary_key));
      const mobileCycles: Record<string, number> = {};
      (cyclesData || []).forEach((c: any) => { mobileCycles[c.mobile_number] = c.current_cycle; });

      const contactsByMobile: Record<string, any[]> = {};
      for (const c of allContacts) {
        const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (mob && mob.length === 10) {
          if (excludeBlacklist && blacklistSet.has(mob)) continue;
          if (!contactsByMobile[mob]) contactsByMobile[mob] = [];
          contactsByMobile[mob].push(c);
        }
      }

      const sentByMobileFilter: Record<string, Record<string, Set<string>>> = {};
      for (const log of allLogs) {
        const mob = log.mobile_number;
        const cycle = log.cycle_number || 1;
        const mobileCycle = mobileCycles[mob] || 1;
        if (cycle !== mobileCycle) continue;
        if (!sentByMobileFilter[mob]) sentByMobileFilter[mob] = {};
        if (!sentByMobileFilter[mob][log.filter_id]) sentByMobileFilter[mob][log.filter_id] = new Set();
        if (log.contact_primary_key) sentByMobileFilter[mob][log.filter_id].add(log.contact_primary_key);
      }

      const getEligible = (f: DripFilter, mob: string) => {
        const contacts = contactsByMobile[mob] || [];
        if (f.message_type === "abc_card") return contacts.filter(c => c.umr_number && c.umr_number.trim()).length;
        if (f.message_type === "abnormal_card") return contacts.filter(c => abnormalPkSet.has(c.primary_key)).length;
        return contacts.length;
      };

      const getEligibleContacts = (f: DripFilter, mob: string) => {
        const contacts = contactsByMobile[mob] || [];
        if (f.message_type === "abc_card") return contacts.filter(c => c.umr_number && c.umr_number.trim());
        if (f.message_type === "abnormal_card") return contacts.filter(c => abnormalPkSet.has(c.primary_key));
        return contacts;
      };

      const getSent = (f: DripFilter, mob: string) => {
        const dripSent = sentByMobileFilter[mob]?.[f.id] || new Set();
        if (f.message_type === "abc_card") {
          const contacts = contactsByMobile[mob] || [];
          const crmSentPks = new Set(contacts.filter(c => c.last_sent_type === "ABC" && c.umr_number && c.umr_number.trim()).map((c: any) => c.primary_key));
          return new Set([...dripSent, ...crmSentPks]).size;
        }
        return dripSent.size;
      };

      const getSentPks = (f: DripFilter, mob: string) => {
        const dripSent = sentByMobileFilter[mob]?.[f.id] || new Set();
        if (f.message_type === "abc_card") {
          const contacts = contactsByMobile[mob] || [];
          const crmSentPks = new Set(contacts.filter(c => c.last_sent_type === "ABC" && c.umr_number && c.umr_number.trim()).map((c: any) => c.primary_key));
          return new Set([...dripSent, ...crmSentPks]);
        }
        return dripSent;
      };

      const allMobiles = Object.keys(contactsByMobile);
      let pendingAbc = 0;
      let pendingAbnormal = 0;
      const pendingAbcRecords: any[] = [];
      const pendingAbnormalRecords: any[] = [];
      const now = new Date();

      for (const mob of allMobiles) {
        let lockedPriority = Infinity;
        for (const f of enabledFilters) {
          const eligible = getEligible(f, mob);
          if (eligible === 0) continue;
          const sent = getSent(f, mob);
          if (sent < eligible) { lockedPriority = f.priority; break; }
        }
        if (lockedPriority === Infinity) continue;

        const cycle = mobileCycles[mob] || 1;

        for (const f of enabledFilters) {
          if (f.priority !== lockedPriority) continue;
          const eligibleContacts = getEligibleContacts(f, mob);
          const sentPks = getSentPks(f, mob);
          const unsent = eligibleContacts.filter(c => !sentPks.has(c.primary_key));

          if (f.message_type === "abc_card") {
            pendingAbc += unsent.length;
            for (const c of unsent) {
              const lastDate = c.last_sent_date ? new Date(c.last_sent_date) : null;
              const daysAgo = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / 86400000) : null;
              pendingAbcRecords.push({
                "Primary Key": c.primary_key,
                "UMR Number": c.umr_number || "",
                "Patient Name": c.patient_name || "",
                "Mobile Number": c.mobile_number || "",
                "Cycle Number": cycle,
                "Last Sent Type": c.last_sent_type || "",
                "Last Sent Date": lastDate ? `${String(lastDate.getDate()).padStart(2,"0")}-${String(lastDate.getMonth()+1).padStart(2,"0")}-${lastDate.getFullYear()}` : "",
                "Days Ago": daysAgo ?? "",
              });
            }
          }
          if (f.message_type === "abnormal_card") {
            pendingAbnormal += unsent.length;
            for (const c of unsent) {
              const lastDate = c.last_sent_date ? new Date(c.last_sent_date) : null;
              const daysAgo = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / 86400000) : null;
              pendingAbnormalRecords.push({
                "Primary Key": c.primary_key,
                "UMR Number": c.umr_number || "",
                "Patient Name": c.patient_name || "",
                "Mobile Number": c.mobile_number || "",
                "Cycle Number": cycle,
                "Last Sent Type": c.last_sent_type || "",
                "Last Sent Date": lastDate ? `${String(lastDate.getDate()).padStart(2,"0")}-${String(lastDate.getMonth()+1).padStart(2,"0")}-${lastDate.getFullYear()}` : "",
                "Days Ago": daysAgo ?? "",
              });
            }
          }
        }
      }

      return { pendingAbc, pendingAbnormal, pendingAbcRecords, pendingAbnormalRecords };
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

    // Compute interval date BEFORE parallel queries so we can use it in the message_send_log filter
    const intervalDate = new Date();
    intervalDate.setDate(intervalDate.getDate() - minInterval);

    // Run ALL queries in parallel for speed
    const [allContacts, blacklistData, abnormalPks, cyclesData, allLogs, recentLogEntries] = await Promise.all([
      fetchAll(supabase.from("crm_contacts").select("id,primary_key,mobile_number,patient_name,umr_number,location,last_sent_date,last_sent_type,record_tag,default_discount_pct,visit_date")),
      excludeBlacklist
        ? supabase.from("crm_blacklist").select("mobile_number").then(r => r.data || [])
        : Promise.resolve([]),
      fetchAll(supabase.from("crm_abnormal_tests").select("contact_primary_key")),
      fetchAll(supabase.from("drip_mobile_cycles").select("mobile_number,current_cycle")),
      fetchAll(supabase.from("drip_campaign_log").select("filter_id,mobile_number,contact_primary_key,cycle_number").eq("status", "sent")),
      fetchAll(supabase.from("message_send_log").select("mobile_number,sent_at").gte("sent_at", intervalDate.toISOString())),
    ]);

    const blacklistSet = new Set(blacklistData.map((b: any) => b.mobile_number));
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
      if (cycle !== mobileCycle) continue;
      if (!sentByMobileFilter[mob]) sentByMobileFilter[mob] = {};
      if (!sentByMobileFilter[mob][log.filter_id]) sentByMobileFilter[mob][log.filter_id] = new Set();
      if (log.contact_primary_key) sentByMobileFilter[mob][log.filter_id].add(log.contact_primary_key);
    }

    // Build set of mobiles that were sent ANY message within minInterval days
    // Check both CRM last_sent_date AND message_send_log (latest sent_at per mobile)
    const recentSentMobiles = new Set<string>();
    for (const c of allContacts) {
      if (c.last_sent_date && new Date(c.last_sent_date) >= intervalDate) {
        const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (mob) recentSentMobiles.add(mob);
      }
    }
    // Merge message_send_log entries — any log within the interval window means skip
    for (const log of recentLogEntries) {
      const mob = (log.mobile_number || "").replace(/\D/g, "").slice(-10);
      if (mob && mob.length === 10) recentSentMobiles.add(mob);
    }

    const getEligibleCount = (filter: DripFilter, mob: string): number => {
      const contacts = contactsByMobile[mob] || [];
      if (filter.once_per_mobile) return 1;
      if (filter.message_type === "abc_card") {
        return contacts.filter(c => c.umr_number && c.umr_number.trim()).length;
      }
      if (filter.message_type === "abnormal_card") {
        return contacts.filter(c => abnormalPkSet.has(c.primary_key)).length;
      }
      return contacts.length;
    };

    // Hybrid sent detection: for ABC cards, also count CRM-sent cards (last_sent_type = "ABC")
    const getSentCount = (filter: DripFilter, mob: string): number => {
      const dripSent = sentByMobileFilter[mob]?.[filter.id] || new Set();
      if (filter.message_type === "abc_card") {
        const contacts = contactsByMobile[mob] || [];
        const crmSentPks = new Set(
          contacts
            .filter(c => c.last_sent_type === "ABC" && c.umr_number && c.umr_number.trim())
            .map(c => c.primary_key)
        );
        // Merge: unique PKs sent via either drip or CRM
        const merged = new Set([...dripSent, ...crmSentPks]);
        return merged.size;
      }
      return dripSent.size;
    };

    const isLockedByHigherPriority = (currentFilter: DripFilter, mob: string): boolean => {
      for (const f of enabledFilters) {
        if (f.priority >= currentFilter.priority) break;
        const eligible = getEligibleCount(f, mob);
        if (eligible === 0) continue; // No data for this filter = not blocking
        const sent = getSentCount(f, mob);
        if (sent < eligible) return true;
      }
      return false;
    };

    const allFiltersComplete = (mob: string): boolean => {
      for (const f of enabledFilters) {
        const eligible = getEligibleCount(f, mob);
        if (eligible === 0) continue; // No data = treat as complete
        const sent = getSentCount(f, mob);
        if (sent < eligible) return false;
      }
      return true;
    };

    // Pre-compute per-mobile: eligible & sent counts for each filter (avoids recalculating per-contact)
    const allMobiles = Object.keys(contactsByMobile);
    const mobileFilterStatus: Record<string, Record<string, { eligible: number; sent: number }>> = {};
    const mobileAllComplete: Record<string, boolean> = {};
    const mobileLockedBy: Record<string, number> = {}; // mobile -> lowest incomplete priority

    for (const mob of allMobiles) {
      mobileFilterStatus[mob] = {};
      let lowestIncomplete = Infinity;
      let hasAnyData = false;
      for (const f of enabledFilters) {
        const eligible = getEligibleCount(f, mob);
        const sent = getSentCount(f, mob);
        mobileFilterStatus[mob][f.id] = { eligible, sent };
        if (eligible > 0) {
          hasAnyData = true;
          if (sent < eligible && f.priority < lowestIncomplete) {
            lowestIncomplete = f.priority;
          }
        }
      }
      mobileAllComplete[mob] = hasAnyData && lowestIncomplete === Infinity;
      mobileLockedBy[mob] = lowestIncomplete;
    }

    // Single-pass collection: process filters in priority order, then redistribute unused quota
    const claimedMobiles = new Set<string>();
    const results: PreviewResult[] = [];

    // Collect ALL eligible candidates per filter (no cap yet)
    const filterCollections: { filter: DripFilter; eligible: any[]; skips: Record<string, number> }[] = [];

    for (const filter of enabledFilters) {
      const skips: Record<string, number> = {};
      const addSkip = (reason: string) => { skips[reason] = (skips[reason] || 0) + 1; };
      const eligible: any[] = [];

      // Apply location filter
      let candidates = allContacts;
      if (filter.location_filter !== "ALL") {
        candidates = candidates.filter((c) => {
          const loc = (c.location || "").trim().toUpperCase();
          return loc === filter.location_filter.toUpperCase();
        });
      }

      // Apply sequence filter
      if (filter.last_sent_type_filter) {
        if (filter.last_sent_type_filter === "__null__") {
          candidates = candidates.filter((c) => !c.last_sent_type);
        } else {
          candidates = candidates.filter((c) => c.last_sent_type === filter.last_sent_type_filter);
        }
      }

      // Apply min interval: skip contacts sent within minInterval days
      if (minInterval > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - minInterval);
        candidates = candidates.filter((c) => {
          if (!c.last_sent_date) return true;
          return new Date(c.last_sent_date) < cutoff;
        });
      }

      // Sort: lowest cycle first, then never-sent patients first within same cycle
      candidates.sort((a, b) => {
        const aMob = (a.mobile_number || "").replace(/\D/g, "").slice(-10);
        const bMob = (b.mobile_number || "").replace(/\D/g, "").slice(-10);
        const aCycle = mobileCycles[aMob] || 1;
        const bCycle = mobileCycles[bMob] || 1;
        if (aCycle !== bCycle) return aCycle - bCycle;
        const aHas = a.last_sent_type ? 1 : 0;
        const bHas = b.last_sent_type ? 1 : 0;
        return aHas - bHas;
      });

      const filterSeenMobiles = new Set<string>();

      for (const c of candidates) {
        const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (!mob || mob.length !== 10) { addSkip("invalid_mobile"); continue; }

        if (excludeBlacklist && blacklistSet.has(mob)) { addSkip("blacklisted"); continue; }

        // Only 1 message per mobile per day across ALL filters
        if (claimedMobiles.has(mob)) { addSkip("duplicate"); continue; }

        // Only 1 record per mobile per filter per day
        if (filterSeenMobiles.has(mob)) { addSkip("duplicate"); continue; }

        // Completion lock: use precomputed status
        const isComplete = mobileAllComplete[mob];
        if (!isComplete && mobileLockedBy[mob] < filter.priority) {
          addSkip("completion_lock"); continue;
        }

        // Check if this filter is already complete for this mobile in current cycle
        const status = mobileFilterStatus[mob]?.[filter.id];
        if (status && status.sent >= status.eligible && !isComplete) {
          addSkip("already_complete"); continue;
        }

        // Check if this specific record was already sent in this cycle
        const sentPks = sentByMobileFilter[mob]?.[filter.id];
        if (sentPks && sentPks.has(c.primary_key)) { addSkip("already_sent_this_cycle"); continue; }

        // Data validation
        if (filter.message_type === "abc_card") {
          if (!c.umr_number || !c.umr_number.trim()) { addSkip("missing_umr"); continue; }
        }
        if (filter.message_type === "abnormal_card") {
          if (!abnormalPkSet.has(c.primary_key)) { addSkip("no_abnormal_history"); continue; }
        }

        filterSeenMobiles.add(mob);
        claimedMobiles.add(mob);
        eligible.push({ ...c, _cycle: mobileCycles[mob] || 1 });
      }

      filterCollections.push({ filter, eligible, skips });
    }

    // Quota enforcement: distribute maxPerDay across filters, unused flows UP to higher priority
    let remaining = maxPerDay;
    // First pass: cap each filter at fair share, track who needs more
    const fairShare = Math.ceil(maxPerDay / enabledFilters.length);
    const filterCapped: { fc: typeof filterCollections[0]; kept: any[]; wantsMore: number }[] = [];

    for (const fc of filterCollections) {
      const cap = Math.min(fc.eligible.length, fairShare);
      filterCapped.push({
        fc,
        kept: fc.eligible.slice(0, cap),
        wantsMore: Math.max(0, fc.eligible.length - cap),
      });
    }

    // Calculate unused quota from filters that didn't use their full share
    let totalKept = filterCapped.reduce((s, f) => s + f.kept.length, 0);
    let unused = maxPerDay - totalKept;

    // Second pass: distribute unused to filters in priority order (highest priority = lowest number)
    if (unused > 0) {
      for (const entry of filterCapped) {
        if (unused <= 0) break;
        if (entry.wantsMore <= 0) continue;
        const extra = Math.min(entry.wantsMore, unused);
        const startIdx = entry.kept.length;
        entry.kept = entry.fc.eligible.slice(0, startIdx + extra);
        unused -= extra;
        entry.wantsMore -= extra;
      }
    }

    // === Second-pass deduplication: remove any mobile that appears in multiple filters ===
    const finalClaimed = new Set<string>();
    for (const entry of filterCapped) {
      entry.kept = entry.kept.filter((record: any) => {
        const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (!mob) return true;
        if (finalClaimed.has(mob)) {
          entry.fc.skips["second_pass_duplicate"] = (entry.fc.skips["second_pass_duplicate"] || 0) + 1;
          return false;
        }
        finalClaimed.add(mob);
        return true;
      });
    }

    // Second-pass min-interval recheck using drip_campaign_log timestamps
    for (const entry of filterCapped) {
      entry.kept = entry.kept.filter((record: any) => {
        const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (!mob) return true;
        if (recentSentMobiles.has(mob)) {
          entry.fc.skips["min_interval_recheck"] = (entry.fc.skips["min_interval_recheck"] || 0) + 1;
          return false;
        }
        return true;
      });
    }

    // Iterative backfill + dedup loop until quota is stable
    let backfillIterations = 0;
    const MAX_BACKFILL_ITERATIONS = 10;

    while (backfillIterations < MAX_BACKFILL_ITERATIONS) {
      backfillIterations++;

      let totalKeptNow = filterCapped.reduce((s: number, f: any) => s + f.kept.length, 0);
      let freeSlots = maxPerDay - totalKeptNow;
      if (freeSlots <= 0) break;

      let backfilled = 0;
      for (const entry of filterCapped) {
        if (freeSlots <= 0) break;
        const alreadyKeptPks = new Set(entry.kept.map((r: any) => r.primary_key));
        const pool = entry.fc.eligible
          .filter((r: any) => !alreadyKeptPks.has(r.primary_key))
          .sort((a: any, b: any) => {
            const aMob = (a.mobile_number || "").replace(/\D/g, "").slice(-10);
            const bMob = (b.mobile_number || "").replace(/\D/g, "").slice(-10);
            return (mobileCycles[aMob] || 1) - (mobileCycles[bMob] || 1);
          });

        for (const record of pool) {
          if (freeSlots <= 0) break;
          const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
          if (!mob) continue;
          if (finalClaimed.has(mob)) continue;
          if (recentSentMobiles.has(mob)) continue;
          if (excludeBlacklist && blacklistSet.has(mob)) continue;

          entry.kept.push(record);
          finalClaimed.add(mob);
          freeSlots--;
          backfilled++;
        }
      }

      if (backfilled === 0) break;

      const recheck = new Set<string>();
      let removedThisPass = 0;
      for (const entry of filterCapped) {
        entry.kept = entry.kept.filter((record: any) => {
          const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
          if (!mob) return true;
          if (recheck.has(mob)) {
            entry.fc.skips["final_dedup"] = (entry.fc.skips["final_dedup"] || 0) + 1;
            removedThisPass++;
            return false;
          }
          if (recentSentMobiles.has(mob)) {
            entry.fc.skips["final_interval_check"] = (entry.fc.skips["final_interval_check"] || 0) + 1;
            removedThisPass++;
            return false;
          }
          recheck.add(mob);
          return true;
        });
      }

      finalClaimed.clear();
      for (const entry of filterCapped) {
        for (const record of entry.kept) {
          const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
          if (mob) finalClaimed.add(mob);
        }
      }

      if (removedThisPass === 0) break;
    }

    // Build results from capped collections
    for (const entry of filterCapped) {
      results.push({
        filterId: entry.fc.filter.id,
        filterName: entry.fc.filter.name,
        eligible: entry.kept.length,
        skipped: Object.entries(entry.fc.skips).map(([reason, count]) => ({ reason, count })),
        records: entry.kept,
      });
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
    if (_moduleSending) return;
    if (!previewResults || previewResults.every((r) => r.eligible === 0)) {
      return toast.error("Run preview first and ensure there are eligible records");
    }

    const trial = isTrialMode;
    const trialMob = testMobile.replace(/\D/g, "").slice(-10);
    const enabledFilters = filters.filter((f) => f.enabled).sort((a, b) => a.priority - b.priority);

    // Fetch global WA settings + template-specific data
    const { data: allSettings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .or("setting_key.like.wa_global_%,setting_key.eq.loyalty_static_expiry_date,setting_key.eq.abnormal_static_expiry_date");
    const cfg: Record<string, string> = {};
    (allSettings || []).forEach((s) => { cfg[s.setting_key] = s.setting_value; });

    // Fetch ABC Card and Abnormal PNG templates
    const { data: abcTmpl } = await supabase.from("marketing_templates").select("whatsapp_template_name, body_mapping, api_base_url, from_number").eq("template_name", "ABC Card").maybeSingle();
    const { data: abnTmpl } = await supabase.from("marketing_templates").select("whatsapp_template_name, body_mapping, api_base_url, from_number").eq("template_name", "Abnormal PNG").maybeSingle();

    // ============= TRIAL MODE: keep client-side for instant feedback (max 3, no DB writes) =============
    if (trial) {
      const trialMax = 3;
      _moduleAbort = false;
      _modulePaused = false;
      abortRef.current = false;
      _moduleSending = true;
      _moduleProgress = 0;
      _modulePhase = "";
      setSending(true);
      setPaused(false);
      setSendProgress(0);

      const _setSendProgress = (v: number) => { _moduleProgress = v; setSendProgress(v); };
      const _setSendPhase = (v: string) => { _modulePhase = v; setSendPhase(v); };
      const _checkAbort = () => abortRef.current || _moduleAbort;

      let totalMessages = Math.min(previewResults.reduce((sum, r) => sum + r.eligible, 0), trialMax);
      let processedCount = 0;
      let trialSentCount = 0;
      let totalSent = 0;
      let totalFailed = 0;

      outer:
      for (const preview of previewResults) {
        if (preview.eligible === 0) continue;
        if (_checkAbort()) break;
        const filter = enabledFilters.find((f) => f.id === preview.filterId);
        if (!filter) continue;

        if (filter.message_type === "abc_card") {
          const loyaltyApiBaseUrl = cfg["wa_global_baseUrl"];
          const loyaltyApiKey = cfg["wa_global_apiKey"];
          const loyaltyTemplateName = abcTmpl?.whatsapp_template_name || "";
          const loyaltyAuthHeaderName = cfg["wa_global_authHeaderName"] || "apikey";
          const loyaltyAuthHeaderPrefix = cfg["wa_global_authHeaderPrefix"] || "";
          const loyaltyFromNumber = cfg["wa_global_fromNumber"] || "";
          const loyaltyCampaignName = abcTmpl?.api_base_url || "";
          const bodyMappingStr = abcTmpl?.body_mapping || "";
          const staticExpiryDate = cfg["loyalty_static_expiry_date"] || "";
          if (!loyaltyApiBaseUrl || !loyaltyApiKey || !loyaltyTemplateName) {
            toast.error("Loyalty WhatsApp API not configured");
            continue;
          }
          let mapping: Record<string, string> = {};
          try { mapping = bodyMappingStr ? JSON.parse(bodyMappingStr) : {}; } catch { mapping = {}; }
          const templateId = filter.template_id || (cardTemplates.length > 0 ? cardTemplates[0].id : null);
          if (!templateId) continue;
          const templateAssets = await getTemplateAssets(templateId);
          if (!templateAssets) continue;
          const { bgImg, placeholders } = templateAssets;

          for (const r of preview.records) {
            if (_checkAbort() || trialSentCount >= trialMax) break outer;
            _setSendPhase(`🧪 TRIAL [${filter.name}] ${trialSentCount + 1}/${trialMax}`);
            const cardData: CardData = {
              Name: r.patient_name || "", Mobile: r.mobile_number || "", UMR: r.umr_number || "",
              "Discount %": `${r.default_discount_pct ?? 20}%`, "Expiry Date": staticExpiryDate,
            };
            const imageUrl = await generateAndUploadCard(templateId, cardData, bgImg, placeholders);
            if (!imageUrl) { totalFailed++; processedCount++; continue; }
            const components: Record<string, unknown> = {};
            if (Object.keys(mapping).length > 0) {
              const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
              components.body = { params: sortedKeys.map((key) => {
                const f = mapping[key];
                if (f === "Name") return r.patient_name || "";
                if (f === "Mobile") return r.mobile_number || "";
                if (f === "UMR") return r.umr_number || "";
                if (f === "Discount %") return `${r.default_discount_pct ?? 20}%`;
                if (f === "Expiry Date") return staticExpiryDate;
                return "";
              })};
            }
            components.header = { type: "image", image: { link: imageUrl } };
            const payload: Record<string, unknown> = {
              from: loyaltyFromNumber, to: `+91${trialMob}`, templateName: loyaltyTemplateName,
              campaignName: loyaltyCampaignName, type: "template", components,
            };
            try {
              const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
                body: { apiBaseUrl: loyaltyApiBaseUrl, apiKey: loyaltyApiKey, authHeaderName: loyaltyAuthHeaderName, authHeaderPrefix: loyaltyAuthHeaderPrefix, payload },
              });
              if (proxyRes.error || proxyRes.data?.status >= 400) totalFailed++;
              else { totalSent++; trialSentCount++; }
            } catch { totalFailed++; }
            processedCount++;
            _setSendProgress(Math.round((processedCount / totalMessages) * 100));
          }
        } else if (filter.message_type === "abnormal_card") {
          const apiBaseUrl = cfg["wa_global_baseUrl"];
          const apiKey = cfg["wa_global_apiKey"];
          const headerName = cfg["wa_global_authHeaderName"] || "apikey";
          const headerPrefix = cfg["wa_global_authHeaderPrefix"] || "";
          const fromNumber = cfg["wa_global_fromNumber"] || "";
          const templateName = abnTmpl?.whatsapp_template_name || "";
          const campaignName = abnTmpl?.api_base_url || "";
          const includeMediaHeader = abnTmpl?.from_number === "media_header_enabled";
          if (!apiBaseUrl || !apiKey || !templateName) {
            toast.error("Abnormal PNG WhatsApp API not configured");
            continue;
          }
          const abnTemplateId = filter.template_id || (abnormalTemplates.length > 0 ? abnormalTemplates[0].id : null);
          let abnTemplate: any = null;
          if (abnTemplateId) {
            const { data } = await supabase.from("abnormal_card_templates").select("*").eq("id", abnTemplateId).single();
            abnTemplate = data;
          }
          const staticExpiryDate = cfg["abnormal_static_expiry_date"] || "";

          for (const r of preview.records) {
            if (_checkAbort() || trialSentCount >= trialMax) break outer;
            _setSendPhase(`🧪 TRIAL [${filter.name}] ${trialSentCount + 1}/${trialMax}`);
            try {
              const { data: tests } = await supabase
                .from("crm_abnormal_tests").select("*").eq("contact_primary_key", r.primary_key).order("test_name");
              if (!tests || tests.length === 0) { totalFailed++; processedCount++; continue; }

              const imageUrl = includeMediaHeader
                ? await generateAbnormalCardForDrip(r, tests, abnTemplate, staticExpiryDate)
                : null;

              const components: Record<string, unknown> = {};
              if (includeMediaHeader && imageUrl) {
                components.header = { type: "image", image: { link: imageUrl } };
              }
              components.body = { params: [(r.patient_name || "").toUpperCase()] };
              const payload: Record<string, unknown> = {
                from: fromNumber, to: `+91${trialMob}`, templateName,
                campaignName, type: "template", components,
              };
              const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
                body: { apiBaseUrl, apiKey, authHeaderName: headerName, authHeaderPrefix: headerPrefix, payload },
              });
              if (proxyRes.error || proxyRes.data?.status >= 400) totalFailed++;
              else { totalSent++; trialSentCount++; }
            } catch { totalFailed++; }
            processedCount++;
            _setSendProgress(Math.round((processedCount / totalMessages) * 100));
          }
        }
        // Trial mode: promotion type still skipped (no media generation needed; can be added later)
      }

      _moduleSending = false; _modulePaused = false; _moduleProgress = 0; _modulePhase = "";
      setSending(false); setPaused(false); _setSendPhase("");
      setPreviewResults(null);
      const aborted = abortRef.current;
      abortRef.current = false;
      toast[aborted ? "warning" : "success"](`Trial complete! Sent: ${totalSent}, Failed: ${totalFailed}`);
      return;
    }

    // ============= LIVE MODE: client-side send loop =============
    _moduleAbort = false;
    _modulePaused = false;
    abortRef.current = false;
    _moduleSending = true;
    _moduleProgress = 0;
    _modulePhase = "";
    setSending(true);
    setPaused(false);
    setSendProgress(0);
    setSendPhase("Preparing campaign...");

    const _setSendProgress = (v: number) => { _moduleProgress = v; setSendProgress(v); };
    const _setSendPhase = (v: string) => { _modulePhase = v; setSendPhase(v); };
    const _checkAbort = () => abortRef.current || _moduleAbort;
    const _waitWhilePaused = async () => {
      while (_modulePaused && !_checkAbort()) {
        await sleepResilient(300);
      }
    };

    const delayRaw = Number(cfg["wa_global_delayMs"]);
    const delayMs = Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 3000;
    const concurrency = Math.max(1, Math.min(10, Math.floor(Number(cfg["wa_global_concurrency"]) || 5)));
    const rateGate = makeTokenBucket(delayMs, concurrency);
    const totalMessages = previewResults.reduce((sum, r) => sum + r.eligible, 0);
    let processedCount = 0;
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    const callProxyAndLog = async (
      payload: Record<string, unknown>,
      apiBaseUrl: string,
      apiKey: string,
      authHeaderName: string,
      authHeaderPrefix: string,
      r: any,
      filter: DripFilter,
      logType: string,
      crmUpdate: Record<string, unknown> | null,
    ): Promise<boolean> => {
      // Snapshot of everything needed to re-send this exact message later from the Retry tab.
      const retryPayload: Record<string, unknown> = {
        kind: "drip-proxy",
        message_type: logType,
        apiBaseUrl,
        apiKey,
        authHeaderName,
        authHeaderPrefix,
        payload,
      };
      try {
        await rateGate.take();
        const proxyRes: any = await Promise.race([
          supabase.functions.invoke("whatsapp-proxy", {
            body: { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
          }),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("proxy_timeout_45s")), 45000)
          ),
        ]);
        const proxyData: any = proxyRes.data;
        const apiOk = !proxyRes.error && (proxyData?.status ?? 200) < 400;
        const messageId = extractMessageId(proxyData);
        const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (apiOk) {
          await logDripAction(filter, r, "sent");
          // CRM update ONLY on success — never mark failed sends as sent.
          if (crmUpdate && r.id) {
            await supabase.from("crm_contacts").update({
              ...crmUpdate,
              last_sent_date: new Date().toISOString(),
            }).eq("id", r.id);
          }
          await logMessageSend(mob, r.patient_name, logType, r.umr_number, r.primary_key, null, messageId);
          return true;
        } else {
          await logDripAction(filter, r, "failed", "wa_api_error");
          await logMessageSend(mob, r.patient_name, logType, r.umr_number, r.primary_key, null, "failed", retryPayload);
          return false;
        }
      } catch (err) {
        const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
        await logDripAction(filter, r, "failed", "wa_exception");
        await logMessageSend(mob, r.patient_name, logType, r.umr_number, r.primary_key, null, "failed", retryPayload);
        return false;
      }
    };

    // Helper: write a diagnostic row to drip_campaign_log when the loop catches
    // an unexpected error (so it shows up in the Execution Log instead of being lost).
    const logDiagnostic = async (
      filter: DripFilter | null,
      record: any | null,
      skipReason: string,
      detail: string,
    ) => {
      try {
        const mob = (record?.mobile_number || "").replace(/\D/g, "").slice(-10);
        await supabase.from("drip_campaign_log").insert({
          filter_id: filter?.id || null,
          filter_name: filter?.name || "—",
          message_type: filter?.message_type || null,
          mobile_number: mob || null,
          patient_name: (record?.patient_name || "") + (detail ? ` · ${detail.slice(0, 140)}` : ""),
          contact_primary_key: record?.primary_key || null,
          status: "failed",
          skip_reason: skipReason,
          cycle_number: record?._cycle || 1,
        });
      } catch {
        // diagnostic logging must never throw
      }
    };

    try {
      const totalFilters = previewResults.filter((p) => p.eligible > 0).length;
      let filterIndex = 0;

      outer:
      for (const preview of previewResults) {
        if (preview.eligible === 0) continue;
        if (_checkAbort()) break;
        const filter = enabledFilters.find((f) => f.id === preview.filterId);
        if (!filter) continue;

        filterIndex++;
        // Phase indicator between filters so the user sees the loop moving on.
        _setSendPhase(`Filter ${filterIndex} of ${totalFilters}: ${filter.name} — preparing…`);

        try {
          if (filter.message_type === "abc_card") {
            const loyaltyApiBaseUrl = cfg["wa_global_baseUrl"];
            const loyaltyApiKey = cfg["wa_global_apiKey"];
            const loyaltyTemplateName = abcTmpl?.whatsapp_template_name || "";
            const loyaltyAuthHeaderName = cfg["wa_global_authHeaderName"] || "apikey";
            const loyaltyAuthHeaderPrefix = cfg["wa_global_authHeaderPrefix"] || "";
            const loyaltyFromNumber = cfg["wa_global_fromNumber"] || "";
            const loyaltyCampaignName = abcTmpl?.api_base_url || "";
            const bodyMappingStr = abcTmpl?.body_mapping || "";
            const staticExpiryDate = cfg["loyalty_static_expiry_date"] || "";
            if (!loyaltyApiBaseUrl || !loyaltyApiKey || !loyaltyTemplateName) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "wa_not_configured");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            let mapping: Record<string, string> = {};
            try { mapping = bodyMappingStr ? JSON.parse(bodyMappingStr) : {}; } catch { mapping = {}; }
            const templateId = filter.template_id || (cardTemplates.length > 0 ? cardTemplates[0].id : null);
            if (!templateId) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "no_template");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            const templateAssets = await getTemplateAssets(templateId);
            if (!templateAssets) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "template_load_error");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            const { bgImg, placeholders } = templateAssets;

            // Bounded worker pool: N workers process records in parallel.
            // Per-record work (card render + storage upload) runs concurrently;
            // the WhatsApp API call itself is serialised via rateGate inside callProxyAndLog.
            {
              const records = preview.records;
              const total = records.length;
              let nextIdx = 0;
              let aborted = false;
              const worker = async () => {
                let pendingSend: Promise<void> | null = null;
                while (true) {
                  if (_checkAbort()) { aborted = true; break; }
                  await _waitWhilePaused();
                  if (_checkAbort()) { aborted = true; break; }
                  const i = nextIdx++;
                  if (i >= total) break;
                  const r = records[i];
                  try {
                    const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
                    _setSendPhase(`Filter ${filterIndex} of ${totalFilters}: ${filter.name} — ABC ${i + 1}/${total} → ${r.patient_name || mob}`);

                    const cardData: CardData = {
                      Name: r.patient_name || "", Mobile: r.mobile_number || "", UMR: r.umr_number || "",
                      "Discount %": `${r.default_discount_pct ?? 20}%`, "Expiry Date": staticExpiryDate,
                    };
                    // Phase A: render + upload (overlaps with the previous send still in flight)
                    const { url: imageUrl, reason: renderReason } = await generateAndUploadCardEx(templateId, cardData, bgImg, placeholders);
                    if (!imageUrl) {
                      await logDripAction(filter, r, "failed", renderReason || "card_generation_error");
                      totalFailed++; processedCount++;
                      _setSendPhase(`Filter ${filterIndex} of ${totalFilters}: ${filter.name} — ABC ${i + 1}/${total} (render failed)`);
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                      continue;
                    }
                    const components: Record<string, unknown> = {};
                    if (Object.keys(mapping).length > 0) {
                      const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
                      components.body = { params: sortedKeys.map((key) => {
                        const f = mapping[key];
                        if (f === "Name") return r.patient_name || "";
                        if (f === "Mobile") return r.mobile_number || "";
                        if (f === "UMR") return r.umr_number || "";
                        if (f === "Discount %") return `${r.default_discount_pct ?? 20}%`;
                        if (f === "Expiry Date") return staticExpiryDate;
                        return "";
                      })};
                    }
                    components.header = { type: "image", image: { link: imageUrl } };
                    const payload: Record<string, unknown> = {
                      from: loyaltyFromNumber, to: `+91${mob}`, templateName: loyaltyTemplateName,
                      campaignName: loyaltyCampaignName, type: "template", components,
                    };
                    // Phase B: drain previous send (back-pressure: at most 1 in-flight per worker), then launch new one
                    if (pendingSend) { await pendingSend; pendingSend = null; }
                    pendingSend = callProxyAndLog(
                      payload, loyaltyApiBaseUrl, loyaltyApiKey, loyaltyAuthHeaderName, loyaltyAuthHeaderPrefix,
                      r, filter, "ABC", { last_sent_type: "ABC", record_tag: null },
                    ).then((ok) => {
                      if (ok) totalSent++; else totalFailed++;
                      processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    }).catch((err) => {
                      console.error("[send_error]", err);
                      totalFailed++; processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    });
                  } catch (recErr) {
                    console.error("[record_error]", recErr);
                    await logDiagnostic(filter, r, "record_error", String((recErr as Error)?.message || recErr));
                    totalFailed++; processedCount++;
                    _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                  }
                }
                // Drain the last in-flight send before the worker exits
                if (pendingSend) { try { await pendingSend; } catch { /* already counted */ } }
              };
              const _poolSize1 = Math.min(concurrency, Math.max(1, total));
              await Promise.all(Array.from({ length: _poolSize1 }, (_, i) => (async () => {
                if (i > 0) await sleepResilient(i * 200);
                if (aborted) return;
                await worker();
              })()));
              if (aborted) break outer;
            }
          } else if (filter.message_type === "abnormal_card") {
            const apiBaseUrl = cfg["wa_global_baseUrl"];
            const apiKey = cfg["wa_global_apiKey"];
            const headerName = cfg["wa_global_authHeaderName"] || "apikey";
            const headerPrefix = cfg["wa_global_authHeaderPrefix"] || "";
            const fromNumber = cfg["wa_global_fromNumber"] || "";
            const templateName = abnTmpl?.whatsapp_template_name || "";
            const campaignName = abnTmpl?.api_base_url || "";
            const includeMediaHeader = abnTmpl?.from_number === "media_header_enabled";
            if (!apiBaseUrl || !apiKey || !templateName) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "wa_not_configured");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            const abnTemplateId = filter.template_id || (abnormalTemplates.length > 0 ? abnormalTemplates[0].id : null);
            let abnTemplate: any = null;
            if (abnTemplateId) {
              const { data } = await supabase.from("abnormal_card_templates").select("*").eq("id", abnTemplateId).single();
              abnTemplate = data;
            }
            const staticExpiryDate = cfg["abnormal_static_expiry_date"] || "";

            // Bounded worker pool — see ABC branch for details.
            {
              const records = preview.records;
              const total = records.length;
              let nextIdx = 0;
              let aborted = false;
              const worker = async () => {
                let pendingSend: Promise<void> | null = null;
                while (true) {
                  if (_checkAbort()) { aborted = true; break; }
                  await _waitWhilePaused();
                  if (_checkAbort()) { aborted = true; break; }
                  const i = nextIdx++;
                  if (i >= total) break;
                  const r = records[i];
                  try {
                    const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
                    _setSendPhase(`Filter ${filterIndex} of ${totalFilters}: ${filter.name} — Abnormal ${i + 1}/${total} → ${r.patient_name || mob}`);

                    const { data: tests } = await supabase
                      .from("crm_abnormal_tests").select("*").eq("contact_primary_key", r.primary_key).order("test_name");
                    if (!tests || tests.length === 0) {
                      await logDripAction(filter, r, "skipped", "no_abnormal_history");
                      totalSkipped++; processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                      continue;
                    }
                    // Phase A: render (overlaps with the previous send still in flight)
                    let imageUrl: string | null = null;
                    if (includeMediaHeader) {
                      const renderRes = await generateAbnormalCardForDripEx(r, tests, abnTemplate, staticExpiryDate);
                      imageUrl = renderRes.url;
                      if (!imageUrl && renderRes.reason) {
                        // Render failed but we still attempt the text-only send below; log the cause for diagnostics.
                        await logDiagnostic(filter, r, "abnormal_render_failed", renderRes.reason);
                      }
                    }

                    const components: Record<string, unknown> = {};
                    if (includeMediaHeader && imageUrl) {
                      components.header = { type: "image", image: { link: imageUrl } };
                    }
                    components.body = { params: [(r.patient_name || "").toUpperCase()] };
                    const payload: Record<string, unknown> = {
                      from: fromNumber, to: `+91${mob}`, templateName,
                      campaignName, type: "template", components,
                    };
                    // Phase B: drain previous send (back-pressure), then launch new one
                    if (pendingSend) { await pendingSend; pendingSend = null; }
                    pendingSend = callProxyAndLog(
                      payload, apiBaseUrl, apiKey, headerName, headerPrefix,
                      r, filter, "Abnormal History", { last_sent_type: "Abnormal History" },
                    ).then((ok) => {
                      if (ok) totalSent++; else totalFailed++;
                      processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    }).catch((err) => {
                      console.error("[send_error]", err);
                      totalFailed++; processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    });
                  } catch (recErr) {
                    console.error("[record_error]", recErr);
                    await logDiagnostic(filter, r, "record_error", String((recErr as Error)?.message || recErr));
                    totalFailed++; processedCount++;
                    _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                  }
                }
                if (pendingSend) { try { await pendingSend; } catch { /* already counted */ } }
              };
              const _poolSize2 = Math.min(concurrency, Math.max(1, total));
              await Promise.all(Array.from({ length: _poolSize2 }, (_, i) => (async () => {
                if (i > 0) await sleepResilient(i * 200);
                if (aborted) return;
                await worker();
              })()));
              if (aborted) break outer;
            }
          } else if (filter.message_type === "promotion") {
            if (!filter.template_id) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "no_template");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            const { data: tmpl } = await supabase.from("marketing_templates").select("*").eq("id", filter.template_id).single();
            if (!tmpl) {
              for (const r of preview.records) await logDripAction(filter, r, "failed", "template_load_error");
              totalFailed += preview.records.length;
              processedCount += preview.records.length;
              _setSendProgress(Math.round((processedCount / totalMessages) * 100));
              continue;
            }
            let bodyMapping: Record<string, string> = {};
            try { bodyMapping = tmpl.body_mapping ? JSON.parse(tmpl.body_mapping) : {}; } catch { bodyMapping = {}; }
            const apiBaseUrl = cfg["wa_global_baseUrl"];
            const apiKey = cfg["wa_global_apiKey"];
            const headerName = cfg["wa_global_authHeaderName"] || "apikey";
            const headerPrefix = cfg["wa_global_authHeaderPrefix"] || "";
            const fromNumber = cfg["wa_global_fromNumber"] || "";

            // Bounded worker pool — see ABC branch for details.
            {
              const records = preview.records;
              const total = records.length;
              let nextIdx = 0;
              let aborted = false;
              const worker = async () => {
                let pendingSend: Promise<void> | null = null;
                while (true) {
                  if (_checkAbort()) { aborted = true; break; }
                  await _waitWhilePaused();
                  if (_checkAbort()) { aborted = true; break; }
                  const i = nextIdx++;
                  if (i >= total) break;
                  const r = records[i];
                  try {
                    const mob = (r.mobile_number || "").replace(/\D/g, "").slice(-10);
                    _setSendPhase(`Filter ${filterIndex} of ${totalFilters}: ${filter.name} — Promotion ${i + 1}/${total} → ${r.patient_name || mob}`);

                    const components: Record<string, unknown> = {};
                    if (Object.keys(bodyMapping).length > 0) {
                      const sortedKeys = Object.keys(bodyMapping).sort((a, b) => Number(a) - Number(b));
                      components.body = { params: sortedKeys.map((key) => {
                        const f = bodyMapping[key];
                        if (f === "Name") return r.patient_name || "";
                        if (f === "Mobile") return r.mobile_number || "";
                        return f || "";
                      })};
                    }
                    const payload: Record<string, unknown> = {
                      from: fromNumber, to: `+91${mob}`, templateName: tmpl.whatsapp_template_name,
                      type: "template", ...(Object.keys(components).length > 0 ? { components } : {}),
                    };
                    // Drain previous send (back-pressure), then launch new one without awaiting it
                    if (pendingSend) { await pendingSend; pendingSend = null; }
                    pendingSend = callProxyAndLog(
                      payload, apiBaseUrl, apiKey, headerName, headerPrefix,
                      r, filter, "Promotion", { last_sent_type: "Promotion" },
                    ).then((ok) => {
                      if (ok) totalSent++; else totalFailed++;
                      processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    }).catch((err) => {
                      console.error("[send_error]", err);
                      totalFailed++; processedCount++;
                      _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                    });
                  } catch (recErr) {
                    console.error("[record_error]", recErr);
                    await logDiagnostic(filter, r, "record_error", String((recErr as Error)?.message || recErr));
                    totalFailed++; processedCount++;
                    _setSendProgress(Math.round((processedCount / totalMessages) * 100));
                  }
                }
                if (pendingSend) { try { await pendingSend; } catch { /* already counted */ } }
              };
              const _poolSize3 = Math.min(concurrency, Math.max(1, total));
              await Promise.all(Array.from({ length: _poolSize3 }, (_, i) => (async () => {
                if (i > 0) await sleepResilient(i * 200);
                if (aborted) return;
                await worker();
              })()));
              if (aborted) break outer;
            }
          }
        } catch (branchErr) {
          // A branch (filter) blew up before/around its inner loop. Log it,
          // notify, and continue to the next filter's pre-claimed records.
          console.error("[loop_error]", branchErr);
          await logDiagnostic(filter, null, "loop_error", String((branchErr as Error)?.message || branchErr));
          toast.error(`Filter "${filter.name}" aborted: ${String((branchErr as Error)?.message || branchErr).slice(0, 120)}. Continuing with next filter.`);
          continue;
        }
      }
    } catch (err) {
      console.error("[campaign_aborted]", err);
      await logDiagnostic(null, null, "campaign_aborted", String((err as Error)?.message || err));
      toast.error("Send loop failed: " + String(err));
    }

    _moduleSending = false; _modulePaused = false; _moduleProgress = 0; _modulePhase = "";
    setSending(false); setPaused(false); _setSendPhase("");
    setPreviewResults(null);
    qc.invalidateQueries({ queryKey: ["drip-campaign-logs"] });
    qc.invalidateQueries({ queryKey: ["drip-pending-counts"] });
    const aborted = abortRef.current;
    abortRef.current = false;
    toast[aborted ? "warning" : "success"](`Done! Sent: ${totalSent}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);
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

  // Delegates to the shared implementation in src/lib/dripCardSenders.ts
  const generateAbnormalCardForDrip = (contact: any, tests: any[], template: any, expiryDate: string) =>
    _sharedGenerateAbnormalCardForDrip(contact, tests, template, expiryDate);

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
      upload_collision: "Upload Collision (retried)",
      upload_5xx: "Storage 5xx / Network",
      upload_failed: "Upload Failed",
      toblob_null: "Canvas Encode Failed",
      ctx_error: "Canvas Context Error",
      abnormal_render_failed: "Abnormal Render Failed (sent text-only)",
      no_template: "No Template",
      template_load_error: "Template Load Error",
      completion_lock: "Locked by Higher Priority",
      already_complete: "Already Complete (this cycle)",
      already_sent_this_cycle: "Already Sent (this cycle)",
      loop_error: "Filter Aborted (loop error)",
      record_error: "Record Error (skipped)",
      campaign_aborted: "Campaign Aborted",
    };
    return labels[r] || r;
  };

  const usagePct = waLimit > 0 ? Math.min(100, Math.round((sentLast24h / waLimit) * 100)) : 0;
  const remaining24h = Math.max(0, waLimit - sentLast24h);

  return (
    <div className="space-y-6">
      {/* 24h WhatsApp Usage Counter */}
      <Card className={sentLast24h >= waLimit ? "border-destructive" : ""}>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MessageCircle className={`h-8 w-8 ${sentLast24h >= waLimit ? "text-destructive" : "text-primary"}`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">{countLoading ? "..." : sentLast24h}</span>
                  <span className="text-muted-foreground text-sm">/ {waLimit}</span>
                  <span className="text-muted-foreground text-xs">messages in last 24h</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={usagePct} className="w-48 h-2" />
                  <span className="text-xs text-muted-foreground">{usagePct}%</span>
                  {remaining24h > 0 && (
                    <Badge variant="secondary" className="text-xs">{remaining24h} remaining</Badge>
                  )}
                  {sentLast24h >= waLimit && (
                    <Badge variant="destructive" className="text-xs">Limit Reached</Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">WA Daily Limit:</Label>
              <Input
                type="number"
                value={waLimit}
                onChange={(e) => {
                  const v = Number(e.target.value) || 250;
                  setWaLimit(v);
                  saveGlobalSetting("wa_daily_limit", String(v));
                }}
                className="w-24 h-8"
                min={1}
              />
              <Button variant="ghost" size="sm" onClick={fetchSentCount} className="text-xs h-8">
                Refresh
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Counts all WhatsApp messages sent from Marketing, CRM, Loyalty Cards & Drip campaigns in last 24 hours. Click Refresh to update.</p>
        </CardContent>
      </Card>

      {/* Pending Counters */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Pending counters reflect snapshot at last refresh — click Refresh to recompute.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchPending()}
            disabled={pendingFetching || filters.length === 0}
            title="Recompute pending ABC + Abnormal counts"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${pendingFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="py-4 flex items-center gap-3">
              <CreditCard className="h-7 w-7 text-primary" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Pending ABC Cards</p>
                {pendingLoading ? (
                  <Skeleton className="h-7 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold">{pendingCounts?.pendingAbc ?? 0}</p>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={pendingLoading || !(pendingCounts?.pendingAbcRecords?.length)} onClick={() => {
                exportToExcel(pendingCounts!.pendingAbcRecords, `Pending_ABC_Cards_${new Date().toISOString().slice(0,10)}`);
                toast.success(`Exported ${pendingCounts!.pendingAbcRecords.length} records`);
              }}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 flex items-center gap-3">
              <Activity className="h-7 w-7 text-primary" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Pending Abnormal History</p>
                {pendingLoading ? (
                  <Skeleton className="h-7 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold">{pendingCounts?.pendingAbnormal ?? 0}</p>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={pendingLoading || !(pendingCounts?.pendingAbnormalRecords?.length)} onClick={() => {
                exportToExcel(pendingCounts!.pendingAbnormalRecords, `Pending_Abnormal_History_${new Date().toISOString().slice(0,10)}`);
                toast.success(`Exported ${pendingCounts!.pendingAbnormalRecords.length} records`);
              }}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>


      {sending && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{paused ? "⏸️ PAUSED — " : ""}{sendPhase}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={paused ? "default" : "outline"}
                onClick={() => {
                  _modulePaused = !_modulePaused;
                  setPaused(_modulePaused);
                  toast.info(_modulePaused ? "Paused — will resume when you click Resume" : "Resumed sending...");
                }}
              >
                {paused ? "▶️ Resume" : "⏸️ Pause"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { abortRef.current = true; _moduleAbort = true; toast.warning("Stopping after current message..."); }}
              >
                ⛔ STOP
              </Button>
            </div>
          </div>
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
            <div className="space-y-3 mt-4">
              {/* Test Mode */}
              <div className="flex items-center gap-3">
                <FlaskConical className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm whitespace-nowrap">Test Mobile (Trial Mode):</Label>
                <Input
                  placeholder="Enter your 10-digit mobile"
                  value={testMobile}
                  onChange={(e) => setTestMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="w-48 h-8"
                />
                {isTrialMode && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs">
                    Max 3 trial messages
                  </Badge>
                )}
              </div>
              {isTrialMode && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>⚠️ TRIAL MODE — All messages will be sent to <strong>+91{testMobile}</strong>. No database logs will be written. Max 3 messages.</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={handlePreview} disabled={previewing || sending}>
                  <Eye className="h-4 w-4 mr-1" />
                  {previewing ? "Previewing..." : "Preview Eligible Records"}
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={sending || !previewResults}
                  variant={isTrialMode ? "outline" : "default"}
                  className={isTrialMode ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100" : ""}
                >
                  {isTrialMode ? <FlaskConical className="h-4 w-4 mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  {isTrialMode ? "Send Trial" : "Send Messages"}
                </Button>
                {sending && (
                  <>
                    <Button
                      onClick={() => {
                        _modulePaused = !_modulePaused;
                        setPaused(_modulePaused);
                        toast.info(_modulePaused ? "Paused" : "Resumed");
                      }}
                      variant={paused ? "default" : "outline"}
                    >
                      {paused ? "▶️ Resume" : "⏸️ Pause"}
                    </Button>
                    <Button
                      onClick={() => { abortRef.current = true; _moduleAbort = true; toast.warning("Stopping after current message..."); }}
                      variant="destructive"
                    >
                      ⛔ STOP
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Results */}
      {previewResults && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Preview Results (Daily Limit: {maxPerDay})</CardTitle>
              <Button variant="outline" size="sm" onClick={() => {
                if (!previewResults) return;
                const rows: Record<string, unknown>[] = [];
                previewResults.forEach((pr) => {
                  pr.records.forEach((r: any, idx: number) => {
                    rows.push({
                      "Filter": pr.filterName,
                      "#": idx + 1,
                      "Patient Name": r.patient_name || "",
                      "Mobile": r.mobile_number || "",
                      "UMR": r.umr_number || "",
                      "Location": r.location || "",
                      "Cycle": r._cycle || 1,
                      "Last Sent Type": r.last_sent_type || "Never",
                      "Last Sent Date": r.last_sent_date ? new Date(r.last_sent_date).toLocaleDateString("en-GB") : "",
                      "Days Ago": r.last_sent_date ? Math.floor((Date.now() - new Date(r.last_sent_date).getTime()) / 86400000) : "",
                    });
                  });
                  pr.skipped.forEach((s) => {
                    for (let i = 0; i < s.count; i++) {
                      rows.push({ "Filter": pr.filterName, "Skip Reason": skipReasonLabel(s.reason) });
                    }
                  });
                });
                exportToExcel(rows, `drip_preview_${new Date().toISOString().slice(0, 10)}`);
                toast.success("Preview exported");
              }}>
                <Download className="h-4 w-4 mr-1" /> Export Preview
              </Button>
            </div>
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
                            <TableHead className="text-xs">Cycle</TableHead>
                            <TableHead className="text-xs">Last Sent Type</TableHead>
                            <TableHead className="text-xs">Last Sent Date</TableHead>
                            <TableHead className="text-xs">Days Ago</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pr.records.map((r: any, idx: number) => {
                            const daysAgo = r.last_sent_date ? Math.floor((Date.now() - new Date(r.last_sent_date).getTime()) / 86400000) : null;
                            return (
                            <TableRow key={r.id || idx}>
                              <TableCell className="text-xs">{idx + 1}</TableCell>
                              <TableCell className="text-xs">{r.patient_name || "-"}</TableCell>
                              <TableCell className="text-xs">{r.mobile_number || "-"}</TableCell>
                              <TableCell className="text-xs">{r.umr_number || "-"}</TableCell>
                              <TableCell className="text-xs">{r.location || "-"}</TableCell>
                              <TableCell className="text-xs">{r._cycle || 1}</TableCell>
                              <TableCell className="text-xs">{r.last_sent_type || "Never"}</TableCell>
                              <TableCell className="text-xs">{r.last_sent_date ? new Date(r.last_sent_date).toLocaleDateString("en-GB") : "-"}</TableCell>
                              <TableCell className="text-xs">{daysAgo !== null ? daysAgo : "-"}</TableCell>
                            </TableRow>
                            );
                          })}
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
          <div className="flex items-center justify-between">
            <CardTitle>Execution Log</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchLogs()}
                disabled={logsFetching}
                title="Refresh execution log"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${logsFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            <Button variant="outline" size="sm" disabled={recentLogs.length === 0} onClick={() => {
              const rows = recentLogs.map((l: any) => ({
                "Date": new Date(l.created_at).toLocaleDateString("en-GB"),
                "Time": new Date(l.created_at).toLocaleTimeString("en-GB"),
                "Filter": l.filter_name || "",
                "Type": l.message_type || "",
                "Patient Name": l.patient_name || "",
                "Mobile": l.mobile_number || "",
                "Status": l.status || "",
                "Skip Reason": l.skip_reason ? skipReasonLabel(l.skip_reason) : "",
                "Cycle": l.cycle_number || 1,
                "Days Ago": l.created_at ? Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000) : "",
              }));
              exportToExcel(rows, `drip_execution_log_${new Date().toISOString().slice(0, 10)}`);
              toast.success("Execution log exported");
            }}>
              <Download className="h-4 w-4 mr-1" /> Export Log
            </Button>
            </div>
          </div>
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
