import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import {
  Calendar as CalendarIcon,
  Search,
  Eye,
  Send,
  MousePointerClick,
  Clock,
  Download as DownloadIcon,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const ReportAnalytics = () => {
  const [dateFrom, setDateFrom] = useState<Date>(startOfDay(subDays(new Date(), 30)));
  const [dateTo, setDateTo] = useState<Date>(endOfDay(new Date()));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [drillToken, setDrillToken] = useState<string | null>(null);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["report_share_links", dateFrom.toISOString(), dateTo.toISOString()],
    queryFn: async () => {
      const { data } = await supabase
        .from("report_share_links")
        .select("*")
        .gte("created_at", dateFrom.toISOString())
        .lte("created_at", dateTo.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      return (data || []) as any[];
    },
  });

  const tokens = useMemo(() => links.map((l) => l.token), [links]);
  const regIds = useMemo(() => Array.from(new Set(links.map((l) => l.registration_id))), [links]);

  const { data: events = [] } = useQuery({
    queryKey: ["report_link_events", tokens.join(",")],
    enabled: tokens.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("report_link_events")
        .select("*")
        .in("token", tokens)
        .order("occurred_at", { ascending: false })
        .limit(20000);
      return (data || []) as any[];
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["report_link_sessions", tokens.join(",")],
    enabled: tokens.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("report_link_sessions")
        .select("token, total_dwell_seconds")
        .in("token", tokens);
      return (data || []) as any[];
    },
  });

  const { data: regs = [] } = useQuery({
    queryKey: ["report_share_regs", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_registrations")
        .select("id, patient_name, mobile_number, due_amount")
        .in("id", regIds);
      return (data || []) as any[];
    },
  });

  const regsMap = useMemo(() => {
    const m: Record<string, any> = {};
    regs.forEach((r) => (m[r.id] = r));
    return m;
  }, [regs]);

  // Aggregate per-token
  const rows = useMemo(() => {
    const evByToken: Record<string, any[]> = {};
    events.forEach((e) => {
      if (!evByToken[e.token]) evByToken[e.token] = [];
      evByToken[e.token].push(e);
    });
    const dwellByToken: Record<string, number> = {};
    sessions.forEach((s) => {
      dwellByToken[s.token] = (dwellByToken[s.token] || 0) + (s.total_dwell_seconds || 0);
    });

    return links.map((l) => {
      const evs = evByToken[l.token] || [];
      const opens = evs.filter((e) => e.event_type === "opened").length;
      const downloads = evs.filter((e) => e.event_type === "downloaded").length;
      const blocked = evs.filter((e) => e.event_type === "blocked_due_pending").length;
      const failed = evs.filter((e) => e.event_type === "verification_failed").length;
      const lastOpen = evs.find((e) => e.event_type === "opened")?.occurred_at || null;
      const reg = regsMap[l.registration_id] || {};
      return {
        token: l.token,
        invoice: l.invoice_number,
        registrationId: l.registration_id,
        patientName: reg.patient_name || "—",
        mobile: reg.mobile_number || "—",
        dueAmount: Number(reg.due_amount || 0),
        sentAt: l.created_at,
        expiresAt: l.expires_at,
        opens,
        downloads,
        blocked,
        failed,
        lastOpen,
        dwellSec: dwellByToken[l.token] || 0,
      };
    });
  }, [links, events, sessions, regsMap]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        String(r.invoice || "").toLowerCase().includes(q) ||
        r.mobile.includes(q)
    );
  }, [rows, search]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // KPIs
  const kpis = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    const links7 = links.filter((l) => new Date(l.created_at).getTime() >= sevenDaysAgo).length;
    const links30 = links.length;
    const totalOpens = rows.reduce((s, r) => s + r.opens, 0);
    const opened = rows.filter((r) => r.opens > 0).length;
    const openRate = links30 > 0 ? Math.round((opened / links30) * 100) : 0;
    const totalDownloads = rows.reduce((s, r) => s + r.downloads, 0);
    const totalBlocked = rows.reduce((s, r) => s + r.blocked, 0);
    const dwellTotal = rows.reduce((s, r) => s + r.dwellSec, 0);
    const avgDwell = opened > 0 ? Math.round(dwellTotal / opened) : 0;
    return { links7, links30, totalOpens, openRate, totalDownloads, totalBlocked, avgDwell };
  }, [links, rows]);

  const fmtDwell = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const drillEvents = useMemo(() => {
    if (!drillToken) return [];
    return events.filter((e) => e.token === drillToken);
  }, [drillToken, events]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Report Analytics</h1>
        <p className="text-sm text-muted-foreground">Patient portal engagement & download tracking</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Send className="h-4 w-4" />} label="Links sent (7d)" value={kpis.links7} />
        <KpiCard icon={<Send className="h-4 w-4" />} label="Links sent (30d)" value={kpis.links30} />
        <KpiCard icon={<MousePointerClick className="h-4 w-4" />} label="Open rate" value={`${kpis.openRate}%`} sub={`${kpis.totalOpens} opens`} />
        <KpiCard icon={<Clock className="h-4 w-4" />} label="Avg dwell" value={fmtDwell(kpis.avgDwell)} />
        <KpiCard icon={<DownloadIcon className="h-4 w-4" />} label="PDF downloads" value={kpis.totalDownloads} />
        <KpiCard icon={<ShieldAlert className="h-4 w-4" />} label="Blocked by due" value={kpis.totalBlocked} variant="warn" />
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(dateFrom, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-50" align="start">
              <DatePickerCalendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(startOfDay(d))} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-sm text-muted-foreground">to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(dateTo, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-50" align="start">
              <DatePickerCalendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(endOfDay(d))} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Patient, invoice, mobile..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-8 h-9 w-64"
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="text-left p-2 font-medium">Patient</th>
                  <th className="text-left p-2 font-medium">Invoice</th>
                  <th className="text-left p-2 font-medium">Sent</th>
                  <th className="text-center p-2 font-medium">Opens</th>
                  <th className="text-left p-2 font-medium">Last open</th>
                  <th className="text-right p-2 font-medium">Dwell</th>
                  <th className="text-center p-2 font-medium">Downloads</th>
                  <th className="text-right p-2 font-medium">Due</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-muted-foreground text-xs">
                      No links in this period.
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => (
                    <tr key={r.token} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        <div className="font-medium">{r.patientName}</div>
                        <div className="text-[10px] text-muted-foreground">{r.mobile}</div>
                      </td>
                      <td className="p-2 font-mono text-xs">{r.invoice}</td>
                      <td className="p-2 text-xs">{format(new Date(r.sentAt), "dd MMM, hh:mm a")}</td>
                      <td className="p-2 text-center">
                        {r.opens > 0 ? (
                          <Badge variant="secondary">{r.opens}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {r.lastOpen ? format(new Date(r.lastOpen), "dd MMM, hh:mm a") : "—"}
                      </td>
                      <td className="p-2 text-right text-xs">{r.dwellSec > 0 ? fmtDwell(r.dwellSec) : "—"}</td>
                      <td className="p-2 text-center">
                        {r.downloads > 0 ? <Badge className="bg-emerald-600">{r.downloads}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                        {r.blocked > 0 && (
                          <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700 text-[10px]">
                            {r.blocked} blocked
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-right text-xs">
                        {r.dueAmount > 0 ? <span className="text-destructive font-medium">₹{r.dueAmount}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDrillToken(r.token)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="p-2 border-t flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* Drill-down */}
      <Dialog open={!!drillToken} onOpenChange={(o) => !o && setDrillToken(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Event timeline · {drillToken}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {drillEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No events recorded.</p>
            ) : (
              drillEvents.map((e) => (
                <div key={e.id} className="border rounded p-2 text-xs flex items-start justify-between gap-2">
                  <div>
                    <Badge variant="outline" className={cn("text-[10px]", eventColor(e.event_type))}>
                      {e.event_type}
                    </Badge>
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <span className="ml-2 text-muted-foreground font-mono text-[10px]">
                        {JSON.stringify(e.metadata)}
                      </span>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-md">
                      {e.user_agent || "—"}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(e.occurred_at), "dd MMM, HH:mm:ss")}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const KpiCard = ({
  icon,
  label,
  value,
  sub,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  variant?: "warn";
}) => (
  <Card className={cn("p-3", variant === "warn" && "border-amber-400")}>
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
    <div className="text-2xl font-bold mt-1">{value}</div>
    {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
  </Card>
);

const eventColor = (type: string) => {
  switch (type) {
    case "downloaded":
      return "border-emerald-500 text-emerald-700";
    case "blocked_due_pending":
      return "border-amber-500 text-amber-700";
    case "verification_failed":
      return "border-destructive text-destructive";
    case "verified":
      return "border-blue-500 text-blue-700";
    default:
      return "";
  }
};

export default ReportAnalytics;
