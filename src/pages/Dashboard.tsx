import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  parseISO,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Users, IndianRupee, Percent, RotateCcw, Wallet, HandCoins, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

type RegRow = {
  id: string;
  created_at: string;
  gross_amount: number | null;
  discount_amount: number | null;
  refund_amount: number | null;
  home_visit_charges: number | null;
  net_amount: number | null;
  final_amount: number | null;
  paid_amount: number | null;
  due_amount: number | null;
  bill_cancelled: boolean | null;
  payments: any;
  tests: any;
  cancelled_tests: any;
};

type ModeTotals = Record<string, number>;

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
}

function listPrice(t: any): number {
  return Number(t?.price ?? 0);
}

function netPrice(t: any): number {
  if (t?.discounted_price != null && t.discounted_price !== "") return Number(t.discounted_price) || 0;
  return listPrice(t);
}

function isPackageItem(t: any, packageIds?: Set<string>): boolean {
  if (String(t?.item_type || "").toLowerCase() === "package") return true;
  const id = String(t?.test_id || "");
  return !!(id && packageIds?.has(id));
}

/** Gross = list prices of active + cancelled tests + home visit charges (even if bill cancelled). */
function registrationGross(r: RegRow): number {
  const tests = Array.isArray(r.tests) ? r.tests : [];
  const cancelled = Array.isArray(r.cancelled_tests) ? r.cancelled_tests : [];
  const testIds = new Set(tests.map((t: any) => t.test_id).filter(Boolean));

  let gross = tests.reduce((s: number, t: any) => s + listPrice(t), 0);
  for (const c of cancelled) {
    const id = c.test_id || c.id;
    if (id && testIds.has(id)) continue; // already counted in tests
    // cancelled_tests may only store refund_amount (discounted); prefer price when present
    gross += Number(c.price ?? c.refund_amount ?? 0);
  }

  // Prefer reconstructed gross when tests JSON is present; fall back to stored columns
  if (tests.length === 0 && cancelled.length === 0) {
    gross = Number(r.gross_amount || 0);
  }

  return gross + Number(r.home_visit_charges || 0);
}

function accumulateModes(target: ModeTotals, payments: any) {
  if (!Array.isArray(payments)) return;
  for (const p of payments) {
    const mode = String(p?.mode || "Other").trim() || "Other";
    const amt = Number(p?.amount || 0);
    if (!amt) continue;
    target[mode] = (target[mode] || 0) + amt;
  }
}

const Dashboard = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [showModes, setShowModes] = useState(false);

  const setRange = (from: Date, to: Date) => {
    setDateFrom(format(from, "yyyy-MM-dd"));
    setDateTo(format(to, "yyyy-MM-dd"));
  };

  const presets = [
    {
      label: "Yesterday",
      apply: () => {
        const y = subDays(new Date(), 1);
        setRange(startOfDay(y), endOfDay(y));
      },
    },
    {
      label: "This Week",
      apply: () => setRange(startOfWeek(new Date(), { weekStartsOn: 1 }), endOfWeek(new Date(), { weekStartsOn: 1 })),
    },
    {
      label: "This Month",
      apply: () => setRange(startOfMonth(new Date()), endOfMonth(new Date())),
    },
    {
      label: "Previous Month",
      apply: () => {
        const prev = subMonths(new Date(), 1);
        setRange(startOfMonth(prev), endOfMonth(prev));
      },
    },
  ];

  const { data: packageIds = [] } = useQuery({
    queryKey: ["dashboard_health_checkup_ids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("health_checkups").select("id");
      if (error) throw error;
      return (data || []).map((r: any) => String(r.id));
    },
    staleTime: 5 * 60_000,
  });

  const packageIdSet = useMemo(() => new Set(packageIds), [packageIds]);

  const { data: registrations = [], isLoading, isFetching } = useQuery({
    queryKey: ["business_dashboard_regs", dateFrom, dateTo],
    queryFn: async () => {
      const from = startOfDay(parseISO(dateFrom)).toISOString();
      const to = endOfDay(parseISO(dateTo)).toISOString();
      const pageSize = 1000;
      let fromIdx = 0;
      const all: RegRow[] = [];
      for (;;) {
        const { data, error } = await supabase
          .from("patient_registrations")
          .select(
            "id, created_at, gross_amount, discount_amount, refund_amount, home_visit_charges, net_amount, final_amount, paid_amount, due_amount, bill_cancelled, payments, tests, cancelled_tests",
          )
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: true })
          .range(fromIdx, fromIdx + pageSize - 1);
        if (error) throw error;
        const rows = (data || []) as RegRow[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        fromIdx += pageSize;
      }
      return all;
    },
  });

  const summary = useMemo(() => {
    let patients = 0;
    let gross = 0;
    let discount = 0;
    let refund = 0;
    let due = 0;
    let received = 0;
    const modes: ModeTotals = {};

    for (const r of registrations) {
      patients += 1;
      gross += registrationGross(r);
      discount += Number(r.discount_amount || 0);
      refund += Number(r.refund_amount || 0);
      due += Number(r.due_amount || 0);
      // Original collections ≈ current paid + refunds already issued
      received += Number(r.paid_amount || 0) + Number(r.refund_amount || 0);
      accumulateModes(modes, r.payments);
    }

    const netRevenue = gross - discount - refund;
    return { patients, gross, discount, refund, due, received, netRevenue, modes };
  }, [registrations]);

  const healthCheckups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; netAmount: number }>();

    for (const r of registrations) {
      const tests = Array.isArray(r.tests) ? r.tests : [];
      const cancelled = Array.isArray(r.cancelled_tests) ? r.cancelled_tests : [];
      const seen = new Set<string>();

      const add = (t: any) => {
        if (!isPackageItem(t, packageIdSet)) return;
        const key = String(t.test_id || t.test_name || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        const name = String(t.test_name || "Health Check-Up");
        const prev = map.get(key) || { name, count: 0, netAmount: 0 };
        prev.count += 1;
        prev.netAmount += netPrice(t);
        map.set(key, prev);
      };

      tests.forEach(add);
      cancelled.forEach((c: any) => add(c));
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [registrations, packageIdSet]);

  const healthCheckupTotalCount = healthCheckups.reduce((s, h) => s + h.count, 0);
  const healthCheckupTotalNet = healthCheckups.reduce((s, h) => s + h.netAmount, 0);

  const modeRows = Object.entries(summary.modes)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const kpiCards = [
    { key: "patients", label: "Patients", value: String(summary.patients), icon: Users, accent: "text-sky-700 bg-sky-50 border-sky-100" },
    { key: "gross", label: "Total Gross Amount", value: money(summary.gross), icon: IndianRupee, accent: "text-slate-700 bg-slate-50 border-slate-100", hint: "Incl. HVC, cancelled tests & cancelled bills" },
    { key: "discount", label: "Discount Amount", value: money(summary.discount), icon: Percent, accent: "text-amber-700 bg-amber-50 border-amber-100" },
    { key: "refund", label: "Refund Amount", value: money(summary.refund), icon: RotateCcw, accent: "text-rose-700 bg-rose-50 border-rose-100" },
    { key: "net", label: "Net Revenue", value: money(summary.netRevenue), icon: Wallet, accent: "text-emerald-700 bg-emerald-50 border-emerald-100", hint: "Gross − Discount − Refund" },
    { key: "due", label: "Due Amount", value: money(summary.due), icon: HandCoins, accent: "text-orange-700 bg-orange-50 border-orange-100" },
    {
      key: "received",
      label: "Received Amount",
      value: money(summary.received),
      icon: CreditCard,
      accent: "text-indigo-700 bg-indigo-50 border-indigo-100",
      hint: "Click for payment mode split",
      clickable: true,
    },
  ] as const;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Registration revenue for {format(parseISO(dateFrom), "dd MMM yyyy")}
            {dateFrom !== dateTo ? ` – ${format(parseISO(dateTo), "dd MMM yyyy")}` : ""}
            {(isLoading || isFetching) && (
              <Loader2 className="inline h-3.5 w-3.5 ml-2 animate-spin text-muted-foreground" />
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDateFrom(today);
            setDateTo(today);
          }}
        >
          Today
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">From Date</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <Label className="text-xs">To Date</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
            </div>
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {presets.map((p) => (
                <Button key={p.label} type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={p.apply}>
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const clickable = "clickable" in card && card.clickable;
          return (
            <button
              key={card.key}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && setShowModes(true)}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                card.accent,
                clickable && "hover:ring-2 hover:ring-indigo-300 cursor-pointer",
                !clickable && "cursor-default",
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium uppercase tracking-wide opacity-80">{card.label}</span>
                <Icon className="h-4 w-4 opacity-70" />
              </div>
              <div className="text-2xl font-bold tabular-nums">{isLoading ? "—" : card.value}</div>
              {"hint" in card && card.hint && (
                <p className="text-[11px] mt-1 opacity-70">{card.hint}</p>
              )}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Health Check-Up</CardTitle>
          <p className="text-sm text-muted-foreground">
            {healthCheckupTotalCount} package{healthCheckupTotalCount === 1 ? "" : "s"} · Net {money(healthCheckupTotalNet)} (excl. home visit charges)
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : healthCheckups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No health check-ups in this date range.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Health Check-Up</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthCheckups.map((h) => (
                    <TableRow key={h.name + h.count}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(h.netAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{healthCheckupTotalCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(healthCheckupTotalNet)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showModes} onOpenChange={setShowModes}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Received Amount — Payment Modes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Split from registration payment modes for bills created in the selected dates.
          </p>
          {modeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No payment mode data.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modeRows.map(([mode, amt]) => (
                    <TableRow key={mode}>
                      <TableCell>{mode}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(amt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(modeRows.reduce((s, [, v]) => s + v, 0))}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            KPI received ({money(summary.received)}) uses paid + refunds. Mode table uses stored payment lines and may differ slightly after later adjustments.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
