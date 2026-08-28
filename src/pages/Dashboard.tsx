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
import { Loader2, Users, IndianRupee, Percent, Wallet, HandCoins, CreditCard, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isHiddenDailyReportType,
  paymentRowGross,
  paymentRowPaid,
} from "@/lib/dailyReportMetrics";
import { patientDisplayName } from "@/lib/patientDisplayName";
import {
  aggregateTestVolume,
  expandRegistrationToLeafContributions,
  fetchDashboardExpansionMaps,
  type TestVolumeRow,
} from "@/lib/dashboardTestVolume";
type RegRow = {
  id: string;
  created_at: string;
  home_visit_charges: number | null;
  due_amount: number | null;
  bill_cancelled: boolean | null;
  visit_type: string | null;
  channel_id: string | null;
  pickup_point_id: string | null;
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

const Dashboard = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [showModes, setShowModes] = useState(false);
  const [testSearch, setTestSearch] = useState("");
  const [drillTest, setDrillTest] = useState<TestVolumeRow | null>(null);

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

  // Same source as Daily Report — payment_transactions in the date range
  const { data: transactions = [], isLoading: txsLoading, isFetching: txsFetching } = useQuery({
    queryKey: ["business_dashboard_txs", dateFrom, dateTo],
    queryFn: async () => {
      const from = startOfDay(parseISO(dateFrom)).toISOString();
      const to = endOfDay(parseISO(dateTo)).toISOString();
      const pageSize = 1000;
      let fromIdx = 0;
      const all: any[] = [];
      for (;;) {
        const { data, error } = await supabase
          .from("payment_transactions" as any)
          .select("*")
          .gte("transaction_date", from)
          .lte("transaction_date", to)
          .order("transaction_date", { ascending: true })
          .range(fromIdx, fromIdx + pageSize - 1);
        if (error) throw error;
        const rows = (data || []) as any[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        fromIdx += pageSize;
      }
      return all;
    },
  });

  const reportTransactions = useMemo(
    () => transactions.filter((t: any) => !isHiddenDailyReportType(t.transaction_type)),
    [transactions],
  );

  const registrationIds = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t: any) => {
      if (t.registration_id) set.add(t.registration_id);
    });
    return Array.from(set);
  }, [transactions]);

  const { data: registrations = [], isLoading: regsLoading, isFetching: regsFetching } = useQuery({
    queryKey: ["business_dashboard_regs", registrationIds],
    enabled: registrationIds.length > 0,
    queryFn: async () => {
      const pageSize = 200;
      const all: RegRow[] = [];
      for (let i = 0; i < registrationIds.length; i += pageSize) {
        const chunk = registrationIds.slice(i, i + pageSize);
        const { data, error } = await supabase
          .from("patient_registrations")
          .select(
            "id, created_at, home_visit_charges, due_amount, bill_cancelled, visit_type, channel_id, pickup_point_id, tests, cancelled_tests",
          )
          .in("id", chunk);
        if (error) throw error;
        all.push(...((data || []) as RegRow[]));
      }
      return all;
    },
  });

  const { data: channelsLookup = [] } = useQuery({
    queryKey: ["dashboard_channels"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("id, billing_type");
      return (data || []) as any[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: pickupsLookup = [] } = useQuery({
    queryKey: ["dashboard_pickups"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("id, billing_type");
      return (data || []) as any[];
    },
    staleTime: 5 * 60_000,
  });

  const isLoading = txsLoading || (registrationIds.length > 0 && regsLoading);
  const isFetching = txsFetching || regsFetching;

  const regMap = useMemo(
    () => Object.fromEntries(registrations.map((r) => [r.id, r])),
    [registrations],
  );
  const channelMap = useMemo(
    () => Object.fromEntries(channelsLookup.map((c: any) => [c.id, c])),
    [channelsLookup],
  );
  const pickupMap = useMemo(
    () => Object.fromEntries(pickupsLookup.map((p: any) => [p.id, p])),
    [pickupsLookup],
  );
  const hvcByRegId = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of registrations) m[r.id] = Number(r.home_visit_charges || 0);
    return m;
  }, [registrations]);

  const billingForReg = (regId?: string | null): "credit" | "debit" => {
    if (!regId) return "debit";
    const r = regMap[regId];
    if (!r) return "debit";
    if (r.visit_type === "pickup_point" && r.pickup_point_id) {
      return pickupMap[r.pickup_point_id]?.billing_type === "credit" ? "credit" : "debit";
    }
    if (r.channel_id) {
      return channelMap[r.channel_id]?.billing_type === "credit" ? "credit" : "debit";
    }
    return "debit";
  };

  const summary = useMemo(() => {
    let gross = 0;
    let discount = 0;
    let finalAmt = 0;
    let received = 0;
    let totalIn = 0;
    let totalOut = 0;
    const modes: ModeTotals = {
      Cash: 0,
      GPay: 0,
      Paytm: 0,
      NEFT: 0,
      "Credit Card": 0,
    };
    const registeredIds = new Set<string>();

    for (const t of reportTransactions) {
      gross += paymentRowGross(t, hvcByRegId);
      discount += Number(t.discount_amount || 0);
      finalAmt += Number(t.final_amount || 0);
      received += paymentRowPaid(t);
      if (t.direction === "in") totalIn += Number(t.total_amount || 0);
      else totalOut += Number(t.total_amount || 0);

      modes.Cash += Number(t.cash_amount || 0);
      modes.GPay += Number(t.gpay_amount || 0);
      modes.Paytm += Number(t.paytm_amount || 0);
      modes.NEFT += Number(t.neft_amount || 0);
      modes["Credit Card"] += Number(t.credit_card_amount || 0);

      if (t.transaction_type === "registration_payment" && t.registration_id) {
        registeredIds.add(t.registration_id);
      }
    }

    let creditDue = 0;
    let debitDue = 0;
    for (const regId of registeredIds) {
      const reg = regMap[regId];
      if (!reg || reg.bill_cancelled) continue;
      const liveDue = Math.max(0, Number(reg.due_amount || 0));
      if (liveDue <= 0.01) continue;
      if (billingForReg(regId) === "credit") creditDue += liveDue;
      else debitDue += liveDue;
    }

    return {
      patients: registeredIds.size,
      gross,
      discount,
      finalAmt,
      received,
      totalIn,
      totalOut,
      netCollection: totalIn + totalOut,
      due: creditDue + debitDue,
      creditDue,
      debitDue,
      modes,
    };
  }, [reportTransactions, hvcByRegId, regMap, channelMap, pickupMap]);

  /** Entire bills cancelled in this date range (same-day + old-bill markers). */
  const cancelledBills = useMemo(() => {
    const cancelRefundByReg = new Map<string, number>();
    for (const t of transactions) {
      if (t.transaction_type !== "refund" && t.transaction_type !== "old_bill_refund") continue;
      const remarks = String(t.remarks || "").toLowerCase();
      if (!remarks.includes("cancelled invoice") && !remarks.includes("bill cancelled")) continue;
      const regId = t.registration_id || t.invoice_number || "";
      if (!regId) continue;
      cancelRefundByReg.set(
        regId,
        (cancelRefundByReg.get(regId) || 0) + Number(t.refund_amount || 0),
      );
    }

    const rows = transactions
      .filter(
        (t: any) =>
          t.transaction_type === "bill_cancellation" || t.transaction_type === "old_bill_cancellation",
      )
      .map((t: any) => {
        const regId = t.registration_id || "";
        const refund = Math.max(
          0,
          cancelRefundByReg.get(regId) || cancelRefundByReg.get(t.invoice_number) || 0,
        );
        return {
          id: t.id,
          invoice_number: t.invoice_number || "—",
          patient_name: t.patient_name || "—",
          transaction_date: t.transaction_date,
          gross: Math.abs(Number(t.gross_amount || 0)),
          discount: Math.abs(Number(t.discount_amount || 0)),
          final: Math.abs(Number(t.final_amount || 0)),
          paid: refund,
          refund,
        };
      })
      .sort((a, b) => String(b.invoice_number).localeCompare(String(a.invoice_number)));

    const totals = rows.reduce(
      (a, r) => ({
        gross: a.gross + r.gross,
        discount: a.discount + r.discount,
        final: a.final + r.final,
        paid: a.paid + r.paid,
        refund: a.refund + r.refund,
      }),
      { gross: 0, discount: 0, final: 0, paid: 0, refund: 0 },
    );

    return { rows, totals };
  }, [transactions]);

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

  // Tests booked by registration date (leaf tests only; packages/profiles/combos expanded)
  const { data: expansionMaps, isLoading: mapsLoading } = useQuery({
    queryKey: ["dashboard_test_expansion_maps"],
    queryFn: fetchDashboardExpansionMaps,
    staleTime: 10 * 60_000,
  });

  const { data: bookedRegs = [], isLoading: bookedRegsLoading } = useQuery({
    queryKey: ["dashboard_booked_regs", dateFrom, dateTo],
    queryFn: async () => {
      const from = startOfDay(parseISO(dateFrom)).toISOString();
      const to = endOfDay(parseISO(dateTo)).toISOString();
      const pageSize = 500;
      const all: any[] = [];
      let fromIdx = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("patient_registrations")
          .select(
            "id, invoice_number, patient_name, title, created_at, bill_cancelled, tests, cancelled_tests",
          )
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: false })
          .range(fromIdx, fromIdx + pageSize - 1);
        if (error) throw error;
        const rows = data || [];
        all.push(...rows);
        if (rows.length < pageSize) break;
        fromIdx += pageSize;
      }
      return all;
    },
  });

  const testVolumeRows = useMemo(() => {
    try {
      if (!expansionMaps) return [] as TestVolumeRow[];
      const contributions = bookedRegs.flatMap((r) =>
        expandRegistrationToLeafContributions(r, expansionMaps),
      );
      return aggregateTestVolume(contributions);
    } catch (e) {
      console.error("Tests Booked aggregation failed", e);
      return [] as TestVolumeRow[];
    }
  }, [bookedRegs, expansionMaps]);

  const filteredTestVolume = useMemo(() => {
    const q = testSearch.trim().toLowerCase();
    if (!q) return testVolumeRows;
    return testVolumeRows.filter((r) => String(r.testName || "").toLowerCase().includes(q));
  }, [testVolumeRows, testSearch]);

  const testVolumeTotals = useMemo(
    () =>
      filteredTestVolume.reduce(
        (a, r) => ({
          qty: a.qty + r.qty,
          gross: a.gross + r.gross,
          discount: a.discount + r.discount,
          net: a.net + r.net,
        }),
        { qty: 0, gross: 0, discount: 0, net: 0 },
      ),
    [filteredTestVolume],
  );

  const testsLoading = mapsLoading || bookedRegsLoading;

  const modeRows = Object.entries(summary.modes)
    .filter(([, v]) => Math.abs(v) > 0.009)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  const kpiCards = [
    { key: "patients", label: "Patients", value: String(summary.patients), icon: Users, accent: "text-sky-700 bg-sky-50 border-sky-100", hint: "Registrations in Daily Report period" },
    { key: "gross", label: "Total Gross Amount", value: money(summary.gross), icon: IndianRupee, accent: "text-slate-700 bg-slate-50 border-slate-100", hint: "Matches Daily Report Gross" },
    { key: "discount", label: "Discount Amount", value: money(summary.discount), icon: Percent, accent: "text-amber-700 bg-amber-50 border-amber-100", hint: "Matches Daily Report Discount" },
    { key: "final", label: "Final Amount", value: money(summary.finalAmt), icon: Wallet, accent: "text-emerald-700 bg-emerald-50 border-emerald-100", hint: "Matches Daily Report Final" },
    { key: "credit_due", label: "Credit Dues", value: money(summary.creditDue), icon: HandCoins, accent: "text-amber-800 bg-amber-50 border-amber-100", hint: "Still unpaid (live)" },
    { key: "debit_due", label: "Debit Dues", value: money(summary.debitDue), icon: HandCoins, accent: "text-orange-700 bg-orange-50 border-orange-100", hint: "Still unpaid (live)" },
    {
      key: "received",
      label: "Received Amount",
      value: money(summary.received),
      icon: CreditCard,
      accent: "text-indigo-700 bg-indigo-50 border-indigo-100",
      hint: "Matches Daily Report Paid / Net Collection — click for modes",
      clickable: true,
    },
  ] as const;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Same totals as Daily Report for {format(parseISO(dateFrom), "dd MMM yyyy")}
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cancelled Bills</CardTitle>
          <p className="text-sm text-muted-foreground">
            Entire bills cancelled in this date range ({cancelledBills.rows.length} bill
            {cancelledBills.rows.length === 1 ? "" : "s"})
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : cancelledBills.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No cancelled bills in this date range.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Cancelled On</TableHead>
                    <TableHead className="text-right">Gross Amount</TableHead>
                    <TableHead className="text-right">Discount Amount</TableHead>
                    <TableHead className="text-right">Final Amount</TableHead>
                    <TableHead className="text-right">Paid Amount</TableHead>
                    <TableHead className="text-right">Refund Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cancelledBills.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.invoice_number}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{r.patient_name}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.transaction_date
                          ? format(parseISO(r.transaction_date), "dd-MM-yyyy hh:mm a")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.discount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.final)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.paid)}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">{money(r.refund)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-semibold">Totals</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(cancelledBills.totals.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(cancelledBills.totals.discount)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(cancelledBills.totals.final)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(cancelledBills.totals.paid)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-destructive">{money(cancelledBills.totals.refund)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tests Booked</CardTitle>
          <p className="text-sm text-muted-foreground">
            Leaf tests only (packages / profiles / combos expanded). Excludes cancelled bills and cancelled tests.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={testSearch}
              onChange={(e) => setTestSearch(e.target.value)}
              placeholder="Search test…"
              className="pl-8"
            />
          </div>
          {testsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filteredTestVolume.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No tests booked in this date range.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Gross Amount</TableHead>
                    <TableHead className="text-right">Discount Amount</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTestVolume.map((row) => (
                    <TableRow
                      key={row.testId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDrillTest(row)}
                    >
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">
                        {row.testName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.discount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{testVolumeTotals.qty}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(testVolumeTotals.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(testVolumeTotals.discount)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(testVolumeTotals.net)}</TableCell>
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
            Same mode totals as Daily Report for the selected dates (refunds reduce the mode).
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
                      <TableCell className={`text-right tabular-nums ${amt < 0 ? "text-destructive" : ""}`}>
                        {amt < 0 ? `−${money(Math.abs(amt))}` : money(amt)}
                      </TableCell>
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
            Received KPI ({money(summary.received)}) matches Daily Report Paid / Net Collection.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!drillTest} onOpenChange={(o) => { if (!o) setDrillTest(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drillTest?.testName || "Test"} — patients</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {drillTest?.qty || 0} booking{(drillTest?.qty || 0) === 1 ? "" : "s"} · Net {money(drillTest?.net || 0)}
          </p>
          {!drillTest || drillTest.patients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No patients.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drillTest.patients.map((p, idx) => (
                    <TableRow key={`${p.registrationId}-${idx}`}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{p.invoiceNumber}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {patientDisplayName({ title: p.title, patient_name: p.patientName })}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {p.createdAt ? format(parseISO(p.createdAt), "dd-MM-yyyy hh:mm a") : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.discount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(drillTest.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(drillTest.discount)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{money(drillTest.net)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
