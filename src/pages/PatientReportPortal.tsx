import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  lookupShareLink,
  logEvent,
  newSessionId,
  startSession,
  heartbeatSession,
} from "@/lib/reportShareLinks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Download,
  ShieldAlert,
  Lock,
  RefreshCw,
  FlaskConical,
  FileText,
  Phone,
  User,
  Calendar as CalendarIcon,
  Share2,
} from "lucide-react";
import { format } from "date-fns";
import TestStatusTimeline from "@/components/report/TestStatusTimeline";
import AbnormalHistorySection from "@/components/report/AbnormalHistorySection";
import PreviousReportsSection from "@/components/report/PreviousReportsSection";
import { cn } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import {
  fetchSiblingRegistrations,
  fetchDepartmentMap,
  fetchAbnormalForUmr,
  fetchPreviousApprovedReports,
} from "@/lib/portalAggregation";

const LAB_PHONE = "+916356556699";
const LAB_PHONE_DISPLAY = "6356 55 66 99";

type LinkState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "needs_verify"; link: any; registration: any }
  | { kind: "locked"; until: number }
  | { kind: "ready"; link: any; registration: any };

const LOCK_KEY_PREFIX = "ph_portal_lock_";
const VERIFY_KEY_PREFIX = "ph_portal_verified_";
const ATTEMPTS_KEY_PREFIX = "ph_portal_attempts_";
const LOCK_DURATION_MS = 15 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const PatientReportPortal = () => {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LinkState>({ kind: "loading" });
  const [verifyInput, setVerifyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces refresh
  const [data, setData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatStartedRef = useRef(false);

  // Set noindex meta and page title
  useEffect(() => {
    document.title = "Your Lab Report — PH PathLabs";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = "noindex, nofollow";
  }, []);

  // Initial link lookup
  useEffect(() => {
    (async () => {
      try {
        // Lock check
        const lockRaw = localStorage.getItem(LOCK_KEY_PREFIX + token);
        if (lockRaw) {
          const until = parseInt(lockRaw, 10);
          if (until > Date.now()) {
            setState({ kind: "locked", until });
            return;
          } else {
            localStorage.removeItem(LOCK_KEY_PREFIX + token);
            localStorage.removeItem(ATTEMPTS_KEY_PREFIX + token);
          }
        }

        const link = await lookupShareLink(token);
        if (!link) {
          setState({ kind: "invalid" });
          return;
        }
        if (new Date(link.expires_at).getTime() < Date.now()) {
          setState({ kind: "expired" });
          return;
        }

        const { data: reg, error: regErr } = await supabase
          .from("patient_registrations")
          .select("id, invoice_number, patient_name, mobile_number, umr_number, dob, due_amount, created_at, tests, cancelled_tests, status, bill_cancelled")
          .eq("id", link.registration_id)
          .maybeSingle();
        if (regErr || !reg) {
          setState({ kind: "invalid" });
          return;
        }
        if (reg.bill_cancelled) {
          setState({ kind: "invalid" });
          return;
        }

        // Already verified within TTL?
        const vRaw = localStorage.getItem(VERIFY_KEY_PREFIX + token);
        const verifiedAt = vRaw ? parseInt(vRaw, 10) : 0;
        if (verifiedAt && Date.now() - verifiedAt < VERIFY_TTL_MS) {
          setState({ kind: "ready", link, registration: reg });
          await logEvent(token, "opened", sessionIdRef.current || undefined);
        } else {
          setState({ kind: "needs_verify", link, registration: reg });
          await logEvent(token, "opened");
        }
      } catch (e) {
        console.error(e);
        setState({ kind: "invalid" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-refresh status every 60s
  useEffect(() => {
    if (state.kind !== "ready") return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [state.kind]);

  // Dwell heartbeat
  useEffect(() => {
    if (state.kind !== "ready" || heartbeatStartedRef.current) return;
    heartbeatStartedRef.current = true;
    const sid = newSessionId();
    sessionIdRef.current = sid;
    startSession(token, sid);
    let alive = true;
    const id = setInterval(() => {
      if (!alive || document.hidden) return;
      heartbeatSession(sid, 10);
    }, 10_000);
    const onHide = () => {
      if (document.hidden) heartbeatSession(sid, 5);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [state.kind, token]);

  // Load full status data + siblings + departments + abnormal + previous
  useEffect(() => {
    if (state.kind !== "ready") return;
    (async () => {
      setLoadingData(true);
      try {
        const reg = state.registration;
        const siblings = await fetchSiblingRegistrations(reg.umr_number, reg.created_at);
        // Ensure current registration is included even if filter missed it.
        const aggregated = (() => {
          const map = new Map<string, any>();
          siblings.forEach((s) => map.set(s.id, s));
          map.set(reg.id, reg);
          return Array.from(map.values()).sort((a, b) =>
            (a.created_at || "").localeCompare(b.created_at || ""),
          );
        })();
        const regIds = aggregated.map((r) => r.id);

        const [
          { data: results },
          { data: tubes },
          { data: snips },
          { data: testsData },
          deptMap,
          abnormal,
          previous,
        ] = await Promise.all([
          supabase
            .from("patient_results")
            .select("registration_id, test_id, status, entered_at, verified_at, approved_at, dispatched_at")
            .in("registration_id", regIds),
          supabase
            .from("sample_tubes" as any)
            .select("registration_id, test_ids, collected_at, accepted_at")
            .in("registration_id", regIds),
          supabase
            .from("outsourced_test_snips")
            .select("registration_id, test_id, outsource_status, sent_at, updated_at")
            .in("registration_id", regIds),
          supabase.from("tests").select("id, test_name"),
          fetchDepartmentMap(),
          fetchAbnormalForUmr(reg.umr_number),
          fetchPreviousApprovedReports(reg.umr_number, regIds),
        ]);
        const testsMap: Record<string, any> = {};
        (testsData || []).forEach((t: any) => {
          testsMap[t.id] = t;
        });
        setData({
          aggregated,
          results: results || [],
          tubes: tubes || [],
          snips: snips || [],
          testsMap,
          deptMap,
          abnormal,
          previous,
        });
      } finally {
        setLoadingData(false);
      }
    })();
  }, [state, tick]);

  const handleVerify = async () => {
    if (state.kind !== "needs_verify") return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const reg = state.registration;
      const input = verifyInput.trim();
      let ok = false;

      // DOB match (formats: dd-MM-yyyy or yyyy-MM-dd or dd/MM/yyyy)
      if (reg.dob) {
        const dobIso = String(reg.dob);
        const d = new Date(dobIso);
        if (!isNaN(d.getTime())) {
          const variants = new Set([
            format(d, "dd-MM-yyyy"),
            format(d, "ddMMyyyy"),
            format(d, "yyyy-MM-dd"),
            format(d, "dd/MM/yyyy"),
          ]);
          const cleanedInput = input.replace(/\s+/g, "");
          if (variants.has(cleanedInput) || variants.has(input)) ok = true;
        }
      }

      // Last 4 of mobile
      if (!ok && reg.mobile_number) {
        const last4 = String(reg.mobile_number).replace(/\D/g, "").slice(-4);
        if (last4 && input.replace(/\D/g, "") === last4) ok = true;
      }

      if (ok) {
        localStorage.setItem(VERIFY_KEY_PREFIX + token, String(Date.now()));
        localStorage.removeItem(ATTEMPTS_KEY_PREFIX + token);
        await logEvent(token, "verified");
        setState({ kind: "ready", link: state.link, registration: reg });
      } else {
        const attRaw = localStorage.getItem(ATTEMPTS_KEY_PREFIX + token);
        const att = (attRaw ? parseInt(attRaw, 10) : 0) + 1;
        localStorage.setItem(ATTEMPTS_KEY_PREFIX + token, String(att));
        await logEvent(token, "verification_failed", undefined, { attempt: att });
        if (att >= 3) {
          const until = Date.now() + LOCK_DURATION_MS;
          localStorage.setItem(LOCK_KEY_PREFIX + token, String(until));
          setState({ kind: "locked", until });
        } else {
          setVerifyError(`Incorrect. ${3 - att} attempt${3 - att === 1 ? "" : "s"} remaining.`);
        }
      }
    } finally {
      setVerifying(false);
    }
  };

  // Build per-test status entries across ALL aggregated registrations
  const testEntries = useMemo(() => {
    if (state.kind !== "ready" || !data) return [];
    const aggregated = (data.aggregated || []) as any[];
    const out: any[] = [];
    const seenKey = new Set<string>(); // dedupe identical test across same reg

    for (const reg of aggregated) {
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const regTubes = (data.tubes || []).filter((t: any) => t.registration_id === reg.id);
      const regResults = (data.results || []).filter((r: any) => r.registration_id === reg.id);
      const regSnips = (data.snips || []).filter((s: any) => s.registration_id === reg.id);

      const leafIds = new Set<string>();
      for (const tb of regTubes) {
        const ids = Array.isArray(tb.test_ids) ? tb.test_ids : [];
        ids.forEach((id: string) => leafIds.add(id));
      }
      const expanded = expandRegistrationTests((reg.tests || []) as any[], leafIds, data.testsMap);
      const active = expanded.filter((t: any) => !cancelledIds.has(t.test_id));

      for (const t of active) {
        const key = `${reg.id}::${t.test_id}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const tInfo = data.testsMap[t.test_id] || {};
        const tube = regTubes.find(
          (tb: any) => Array.isArray(tb.test_ids) && tb.test_ids.includes(t.test_id),
        );
        const tResults = regResults.filter((r: any) => r.test_id === t.test_id);
        const snip = regSnips.find((s: any) => s.test_id === t.test_id);

        const hasApproved =
          tResults.some((r: any) => r.status === "approved" || r.status === "dispatched") ||
          (snip && (snip.outsource_status === "approved" || snip.outsource_status === "dispatched"));
        const hasVerified =
          hasApproved ||
          tResults.some((r: any) => r.status === "verified") ||
          (snip && snip.outsource_status === "verified");
        const hasEntered =
          hasVerified ||
          tResults.some((r: any) =>
            ["entered", "results_entered", "results_saved"].includes(r.status),
          ) ||
          (snip && ["results_entered", "results_saved"].includes(snip.outsource_status));

        const earliest = (field: string) => {
          const vals = tResults.map((r: any) => r[field]).filter(Boolean);
          return vals.length ? vals.sort()[0] : null;
        };
        let enteredAt = earliest("entered_at");
        let verifiedAt = earliest("verified_at");
        let approvedAt = earliest("approved_at");
        if (snip && tResults.length === 0) {
          const stime = snip.updated_at || snip.sent_at;
          if (hasEntered && !enteredAt) enteredAt = stime;
          if (hasVerified && !verifiedAt) verifiedAt = stime;
          if (hasApproved && !approvedAt) approvedAt = stime;
        }

        const steps = [
          { label: "Collected", shortLabel: "Coll", timestamp: tube?.collected_at || null },
          { label: "Accepted", shortLabel: "Acpt", timestamp: tube?.accepted_at || null },
          { label: "Entered", shortLabel: "Entr", timestamp: hasEntered ? enteredAt : null },
          { label: "Verified", shortLabel: "Verf", timestamp: hasVerified ? verifiedAt : null },
          { label: "Approved", shortLabel: "Aprv", timestamp: hasApproved ? approvedAt : null },
        ];

        let statusLabel = "Awaiting sample collection";
        if (hasApproved) statusLabel = "Report ready";
        else if (hasVerified) statusLabel = "Awaiting doctor approval";
        else if (hasEntered) statusLabel = "Awaiting verification";
        else if (tube?.accepted_at) statusLabel = "Sample being processed";
        else if (tube?.collected_at) statusLabel = "Sample collected";

        const dept = data.deptMap?.testDept?.[t.test_id] || "Other";

        out.push({
          key,
          registrationId: reg.id,
          testId: t.test_id,
          testName: t.test_name || tInfo.test_name || "Test",
          steps,
          statusLabel,
          approved: hasApproved,
          department: dept,
        });
      }
    }
    return out;
  }, [state, data]);

  // Group by department, sorted by display_order then alpha; tests sorted alpha within group.
  const groupedEntries = useMemo(() => {
    const deptOrder: Record<string, number> = (data?.deptMap?.deptOrder as any) || {};
    const groups: Record<string, any[]> = {};
    for (const e of testEntries) {
      const d = e.department || "Other";
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    }
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      const oa = deptOrder[a] ?? 999;
      const ob = deptOrder[b] ?? 999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
    keys.forEach((k) =>
      groups[k].sort((a, b) => a.testName.localeCompare(b.testName)),
    );
    return keys.map((k) => ({ department: k, tests: groups[k] }));
  }, [testEntries, data]);

  const approvedCount = testEntries.filter((e) => e.approved).length;
  const totalCount = testEntries.length;
  const allApproved = totalCount > 0 && approvedCount === totalCount;

  // Sum dues across all aggregated registrations
  const dueAmount = useMemo(() => {
    if (state.kind !== "ready" || !data) return Number(state.kind === "ready" ? state.registration.due_amount || 0 : 0);
    const agg = (data.aggregated || []) as any[];
    return agg.reduce((s, r) => s + Number(r.due_amount || 0), 0);
  }, [state, data]);

  const downloadAllowed = approvedCount > 0 && dueAmount <= 0;

  // Download approved reports across all aggregated registrations
  const goDownloadApproved = async () => {
    if (state.kind !== "ready" || !data) return;
    if (dueAmount > 0) {
      await logEvent(token, "blocked_due_pending", sessionIdRef.current || undefined);
      return;
    }
    await logEvent(token, "download_attempted", sessionIdRef.current || undefined, {
      approved_count: approvedCount,
      total_count: totalCount,
      registration_ids: (data.aggregated || []).map((r: any) => r.id),
    });
    // Group approved tests by registration
    const byReg: Record<string, string[]> = {};
    for (const e of testEntries) {
      if (!e.approved) continue;
      if (!byReg[e.registrationId]) byReg[e.registrationId] = [];
      byReg[e.registrationId].push(e.testId);
    }
    const regIds = Object.keys(byReg);
    if (regIds.length === 0) return;
    await logEvent(token, "downloaded", sessionIdRef.current || undefined, {
      approved_count: approvedCount,
      total_count: totalCount,
      registration_ids: regIds,
    });
    // Open each (skip current tab for the first; new tab for the rest)
    const first = regIds[0];
    const firstUrl = allApproved
      ? `/lims/report/${first}?public=${encodeURIComponent(token)}`
      : `/lims/report/${first}?tests=${byReg[first].join(",")}&public=${encodeURIComponent(token)}`;
    for (let i = 1; i < regIds.length; i++) {
      const r = regIds[i];
      const u = allApproved
        ? `/lims/report/${r}?public=${encodeURIComponent(token)}`
        : `/lims/report/${r}?tests=${byReg[r].join(",")}&public=${encodeURIComponent(token)}`;
      window.open(u, "_blank", "noopener,noreferrer");
    }
    navigate(firstUrl);
  };

  // Download a previous report by registration id
  const goDownloadPrevious = async (registrationId: string) => {
    if (state.kind !== "ready") return;
    await logEvent(token, "download_attempted", sessionIdRef.current || undefined, {
      previous: true,
      registration_id: registrationId,
    });
    await logEvent(token, "downloaded", sessionIdRef.current || undefined, {
      previous: true,
      registration_id: registrationId,
    });
    navigate(`/lims/report/${registrationId}?public=${encodeURIComponent(token)}`);
  };


  // ── Render states ──
  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.kind === "invalid") {
    return (
      <PortalShell>
        <Card className="p-8 text-center max-w-md mx-auto">
          <ShieldAlert className="h-12 w-12 mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold">Invalid link</h2>
          <p className="text-sm text-muted-foreground mt-2">
            This report link is not valid. Please contact PH PathLabs for assistance.
          </p>
        </Card>
      </PortalShell>
    );
  }

  if (state.kind === "expired") {
    return (
      <PortalShell>
        <Card className="p-8 text-center max-w-md mx-auto">
          <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
          <h2 className="text-lg font-semibold">This link has expired</h2>
          <p className="text-sm text-muted-foreground mt-2">
            For your security, report links are valid for 7 days. Please contact PH PathLabs to request a new link.
          </p>
        </Card>
      </PortalShell>
    );
  }

  if (state.kind === "locked") {
    const minutes = Math.ceil((state.until - Date.now()) / 60_000);
    return (
      <PortalShell>
        <Card className="p-8 text-center max-w-md mx-auto">
          <Lock className="h-12 w-12 mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold">Too many failed attempts</h2>
          <p className="text-sm text-muted-foreground mt-2">
            For security, this link has been temporarily locked. Please try again in {minutes} minute
            {minutes === 1 ? "" : "s"}.
          </p>
        </Card>
      </PortalShell>
    );
  }

  if (state.kind === "needs_verify") {
    return (
      <PortalShell>
        <Card className="p-6 max-w-md mx-auto">
          <div className="text-center mb-4">
            <Lock className="h-10 w-10 mx-auto text-primary mb-2" />
            <h2 className="text-lg font-semibold">Verify your identity</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Please confirm your <strong>date of birth</strong> or <strong>last 4 digits of mobile</strong> to view your report status.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="verify">DOB (DD-MM-YYYY) or last 4 of mobile</Label>
              <Input
                id="verify"
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                placeholder="e.g. 15-08-1985 or 4567"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleVerify();
                }}
                autoFocus
              />
            </div>
            {verifyError && <p className="text-xs text-destructive">{verifyError}</p>}
            <Button onClick={handleVerify} disabled={verifying || !verifyInput.trim()} className="w-full">
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </Button>
          </div>
        </Card>
      </PortalShell>
    );
  }

  // ── READY ──
  const reg = state.registration;
  const aggregated = (data?.aggregated || [reg]) as any[];
  const otherInvoices = aggregated
    .filter((r) => r.id !== reg.id)
    .map((r) => r.invoice_number)
    .filter(Boolean);

  return (
    <PortalShell>
      <div className="max-w-3xl mx-auto space-y-4 pb-24">
        {/* Patient header */}
        <Card className="p-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <h1 className="text-lg font-semibold">{reg.patient_name}</h1>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Invoice {reg.invoice_number}
                  {otherInvoices.length > 0 && (
                    <span className="ml-1 text-primary">
                      (+ {otherInvoices.join(", ")} – same day)
                    </span>
                  )}
                </span>
                {reg.umr_number && <span>UMR: {reg.umr_number}</span>}
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {reg.mobile_number}
                </span>
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3" />
                  {format(new Date(reg.created_at), "dd-MM-yyyy")}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTick((t) => t + 1)}
              className="gap-1"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </Card>

        {/* Due banner */}
        {dueAmount > 0 && (
          <Card className="p-4 border-amber-400 bg-amber-50 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                  Payment pending: ₹{dueAmount}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Reports will be available for download once the balance is cleared. Please contact PH PathLabs to settle the dues.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Tests grouped by department */}
        {loadingData ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : groupedEntries.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No tests found for this report.
          </Card>
        ) : (
          <div className="space-y-4">
            {groupedEntries.map((group) => (
              <Card key={group.department} className="p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold text-sm uppercase tracking-wide">
                    {group.department}
                  </h2>
                  <Badge variant="secondary" className="text-[10px]">
                    {group.tests.length}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {group.tests.map((t: any) => (
                    <div key={t.key} className="border-b last:border-0 pb-3 last:pb-0">
                      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{t.testName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t.statusLabel}
                          </p>
                        </div>
                        {t.approved ? (
                          <Badge className="bg-emerald-600 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            In progress
                          </Badge>
                        )}
                      </div>
                      <TestStatusTimeline steps={t.steps} />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Consolidated download */}
        {totalCount > 0 && (
          <Card className={cn("p-4 text-center", !downloadAllowed && "opacity-70")}>
            {dueAmount > 0 ? (
              <p className="text-xs text-muted-foreground">
                Download will be available once the pending balance is cleared.
              </p>
            ) : approvedCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                Download will be available once at least one test is approved.
              </p>
            ) : (
              <Button onClick={goDownloadApproved} className="gap-2">
                <Download className="h-4 w-4" />
                {allApproved
                  ? "Download Full Report"
                  : `Download Approved Reports (${approvedCount} of ${totalCount})`}
              </Button>
            )}
          </Card>
        )}

        {/* Abnormal History */}
        {data?.abnormal && Object.keys(data.abnormal).length > 0 && (
          <AbnormalHistorySection grouped={data.abnormal} />
        )}

        {/* Previous Reports */}
        {data?.previous && data.previous.length > 0 && (
          <PreviousReportsSection
            reports={data.previous}
            token={token}
            onDownload={goDownloadPrevious}
          />
        )}

        <p className="text-[10px] text-center text-muted-foreground pt-2">
          PH PathLabs · Secure Patient Portal · Result values are released only after doctor approval.
        </p>
      </div>

      {/* Sticky call footer */}
      <div className="fixed bottom-0 inset-x-0 z-50 bg-card border-t shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground hidden sm:block">Need help?</p>
          <a
            href={`tel:${LAB_PHONE}`}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
          >
            <Phone className="h-4 w-4" />
            Call PH PathLabs · {LAB_PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </PortalShell>
  );
};

const PortalShell = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-muted/20">
    <header className="sticky top-0 z-40 bg-card border-b">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <FlaskConical className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <p className="font-semibold text-sm leading-tight">PH PathLabs</p>
          <p className="text-[10px] text-muted-foreground leading-tight">Patient Report Portal</p>
        </div>
      </div>
    </header>
    <main className="px-4 py-4">{children}</main>
  </div>
);

export default PatientReportPortal;
