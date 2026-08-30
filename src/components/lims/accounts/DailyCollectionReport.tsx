import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, parseISO, addDays, eachDayOfInterval } from "date-fns";
import * as XLSX from "@e965/xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { toast } from "sonner";
import { isHiddenDailyReportType, paymentRowPaid } from "@/lib/dailyReportMetrics";
import { getCurrentUserName } from "@/lib/auth";
import { cn } from "@/lib/utils";

type DayRow = {
  dayKey: string;
  dateLabel: string;
  paid: number;
  cash: number;
  gpay: number;
  paytm: number;
  neft: number;
  creditCard: number;
};

type TallyStatusRow = {
  day_key: string;
  paid: number;
  cash: number;
  gpay: number;
  paytm: number;
  neft: number;
  credit_card: number;
  entered_at: string;
  entered_by: string | null;
  last_verified_at: string;
  last_verified_by: string | null;
  verify_count: number;
};

type TallyUiStatus = "unentered" | "entered" | "reverify";

const money = (n: number) =>
  n < 0
    ? `-₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const amtEq = (a: number, b: number) => Math.abs(num(a) - num(b)) < 0.005;

const todayKey = () => format(new Date(), "yyyy-MM-dd");
const yesterdayKey = () => format(addDays(new Date(), -1), "yyyy-MM-dd");
/** Wide scan start for Pending inventory (date filter ignored when Pending is on). */
const ALL_TIME_FROM = "2020-01-01";
const clampPast = (day: string, latest: string) => (day > latest ? latest : day);

const stamp = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "dd-MM-yyyy HH:mm");
  } catch {
    return iso;
  }
};

const snapshotMatches = (row: DayRow, st: TallyStatusRow) =>
  amtEq(row.paid, Number(st.paid)) &&
  amtEq(row.cash, Number(st.cash)) &&
  amtEq(row.gpay, Number(st.gpay)) &&
  amtEq(row.paytm, Number(st.paytm)) &&
  amtEq(row.neft, Number(st.neft)) &&
  amtEq(row.creditCard, Number(st.credit_card));

const uiStatusFor = (row: DayRow, st: TallyStatusRow | undefined): TallyUiStatus => {
  if (!st) return "unentered";
  return snapshotMatches(row, st) ? "entered" : "reverify";
};

const tallyStatusLabel = (row: DayRow, st: TallyStatusRow | undefined): string => {
  const ui = uiStatusFor(row, st);
  if (ui === "unentered" || ui === "reverify") return "Pending";
  if ((st?.verify_count || 0) > 1) return "Reverified and entered";
  return "Entered";
};

/** Accountant view: date totals + Tally Entered / Reverify tracking. Never includes today. */
const DailyCollectionReport = () => {
  const qc = useQueryClient();
  const latestAllowed = yesterdayKey();
  const [dateFrom, setDateFrom] = useState(latestAllowed);
  const [dateTo, setDateTo] = useState(latestAllowed);
  const [pendingOnly, setPendingOnly] = useState(false);

  const effectiveFrom = clampPast(dateFrom, latestAllowed);
  const effectiveTo = clampPast(dateTo < effectiveFrom ? effectiveFrom : dateTo, latestAllowed);

  const { data: transactions = [], isLoading, isFetching } = useQuery({
    queryKey: ["accounts_daily_collection", ALL_TIME_FROM, latestAllowed],
    queryFn: async () => {
      const from = startOfDay(parseISO(ALL_TIME_FROM)).toISOString();
      const to = endOfDay(parseISO(latestAllowed)).toISOString();
      const pageSize = 1000;
      const all: any[] = [];
      let fromIdx = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("payment_transactions" as any)
          .select(
            "transaction_date, transaction_type, total_amount, paid_amount, refund_amount, cash_amount, gpay_amount, paytm_amount, neft_amount, credit_card_amount",
          )
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

  const { data: tallyRows = [], isLoading: tallyLoading } = useQuery({
    queryKey: ["accounts_tally_day_status", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_tally_day_status" as any)
        .select("*")
        .lte("day_key", latestAllowed);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        day_key: String(r.day_key).slice(0, 10),
      })) as TallyStatusRow[];
    },
  });

  const tallyByDay = useMemo(() => {
    const m = new Map<string, TallyStatusRow>();
    for (const r of tallyRows) m.set(r.day_key, r);
    return m;
  }, [tallyRows]);

  /** All collection days (activity + any tally-marked day), never includes today. */
  const allDayRows: DayRow[] = useMemo(() => {
    const today = todayKey();
    const byDay = new Map<string, DayRow>();

    const ensure = (dayKey: string): DayRow | null => {
      if (!dayKey || dayKey >= today || dayKey > latestAllowed) return null;
      let row = byDay.get(dayKey);
      if (!row) {
        row = {
          dayKey,
          dateLabel: format(parseISO(dayKey), "dd-MM-yyyy"),
          paid: 0,
          cash: 0,
          gpay: 0,
          paytm: 0,
          neft: 0,
          creditCard: 0,
        };
        byDay.set(dayKey, row);
      }
      return row;
    };

    for (const st of tallyRows) ensure(st.day_key);

    for (const tx of transactions) {
      if (isHiddenDailyReportType(tx.transaction_type)) continue;
      const dayKey = format(parseISO(tx.transaction_date), "yyyy-MM-dd");
      const row = ensure(dayKey);
      if (!row) continue;
      row.paid += paymentRowPaid(tx);
      row.cash += Number(tx.cash_amount || 0);
      row.gpay += Number(tx.gpay_amount || 0);
      row.paytm += Number(tx.paytm_amount || 0);
      row.neft += Number(tx.neft_amount || 0);
      row.creditCard += Number(tx.credit_card_amount || 0);
    }

    return Array.from(byDay.values())
      .map((r) => ({
        ...r,
        paid: num(r.paid),
        cash: num(r.cash),
        gpay: num(r.gpay),
        paytm: num(r.paytm),
        neft: num(r.neft),
        creditCard: num(r.creditCard),
      }))
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [transactions, tallyRows, latestAllowed]);

  const allByDay = useMemo(() => {
    const m = new Map<string, DayRow>();
    for (const r of allDayRows) m.set(r.dayKey, r);
    return m;
  }, [allDayRows]);

  /** Date-filter view: every calendar day in From-To (zeros for quiet days). */
  const rangeDayRows: DayRow[] = useMemo(() => {
    const rows: DayRow[] = [];
    try {
      const days = eachDayOfInterval({
        start: parseISO(effectiveFrom),
        end: parseISO(effectiveTo),
      });
      for (const d of days) {
        const dayKey = format(d, "yyyy-MM-dd");
        if (dayKey > latestAllowed) continue;
        const existing = allByDay.get(dayKey);
        rows.push(
          existing || {
            dayKey,
            dateLabel: format(d, "dd-MM-yyyy"),
            paid: 0,
            cash: 0,
            gpay: 0,
            paytm: 0,
            neft: 0,
            creditCard: 0,
          },
        );
      }
    } catch {
      // invalid range
    }
    return rows;
  }, [allByDay, effectiveFrom, effectiveTo, latestAllowed]);

  /** Pending inventory ignores From/To - all unentered + reverify dates. */
  const pendingRows: DayRow[] = useMemo(
    () =>
      allDayRows.filter((r) => {
        const st = uiStatusFor(r, tallyByDay.get(r.dayKey));
        return st === "unentered" || st === "reverify";
      }),
    [allDayRows, tallyByDay],
  );

  const displayRows = useMemo(
    () => (pendingOnly ? pendingRows : rangeDayRows),
    [pendingOnly, pendingRows, rangeDayRows],
  );
  const totals = useMemo(
    () =>
      displayRows.reduce(
        (a, r) => ({
          paid: a.paid + r.paid,
          cash: a.cash + r.cash,
          gpay: a.gpay + r.gpay,
          paytm: a.paytm + r.paytm,
          neft: a.neft + r.neft,
          creditCard: a.creditCard + r.creditCard,
        }),
        { paid: 0, cash: 0, gpay: 0, paytm: 0, neft: 0, creditCard: 0 },
      ),
    [displayRows],
  );

  const pendingCount = pendingRows.length;


  const markMutation = useMutation({
    mutationFn: async (opts: { row: DayRow; mode: "enter" | "reverify" }) => {
      const { row, mode } = opts;
      const who = getCurrentUserName() || "staff";
      const now = new Date().toISOString();
      const existing = tallyByDay.get(row.dayKey);
      const payload = {
        day_key: row.dayKey,
        paid: row.paid,
        cash: row.cash,
        gpay: row.gpay,
        paytm: row.paytm,
        neft: row.neft,
        credit_card: row.creditCard,
        entered_at: existing?.entered_at || now,
        entered_by: existing?.entered_by || who,
        last_verified_at: now,
        last_verified_by: who,
        updated_at: now,
        verify_count: (existing?.verify_count || 0) + 1,
      };
      const { error } = await supabase
        .from("accounts_tally_day_status" as any)
        .upsert(payload as any, { onConflict: "day_key" });
      if (error) throw error;
      return mode;
    },
    onSuccess: (mode) => {
      toast.success(mode === "enter" ? "Marked Entered in Tally" : "Reverified and entered");
      qc.invalidateQueries({ queryKey: ["accounts_tally_day_status"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update Tally status"),
  });

  const sameDay = effectiveFrom === effectiveTo;
  const canGoNext = sameDay && format(addDays(parseISO(effectiveFrom), 1), "yyyy-MM-dd") <= latestAllowed;

  const setRangeClamped = (from: string, to: string) => {
    const f = clampPast(from, latestAllowed);
    const t = clampPast(to, latestAllowed);
    setDateFrom(f);
    setDateTo(t < f ? f : t);
  };

  const goPrev = () => {
    if (!sameDay) {
      toast.message("Previous works when From and To are the same date");
      return;
    }
    const prev = format(addDays(parseISO(effectiveFrom), -1), "yyyy-MM-dd");
    setRangeClamped(prev, prev);
  };

  const goNext = () => {
    if (!sameDay) {
      toast.message("Next works when From and To are the same date");
      return;
    }
    const next = format(addDays(parseISO(effectiveFrom), 1), "yyyy-MM-dd");
    if (next > latestAllowed) {
      toast.message("Current day is not shown in Accounts");
      return;
    }
    setRangeClamped(next, next);
  };

  const exportExcel = () => {
    if (displayRows.length === 0) {
      toast.error("No data to export");
      return;
    }
    const rows = displayRows.map((r) => {
      const st = tallyByDay.get(r.dayKey);
      return {
        Date: r.dateLabel,
        "Total Collection (Paid)": r.paid,
        Cash: r.cash,
        GPay: r.gpay,
        Paytm: r.paytm,
        NEFT: r.neft,
        "Credit Card": r.creditCard,
        "Tally Status": tallyStatusLabel(r, st),
        "Entered At": st ? stamp(st.entered_at) : "",
        "Last Verified At": st ? stamp(st.last_verified_at) : "",
        "Entered By": st?.entered_by || "",
        "Last Verified By": st?.last_verified_by || "",
      };
    });
    rows.push({
      Date: "TOTAL",
      "Total Collection (Paid)": num(totals.paid),
      Cash: num(totals.cash),
      GPay: num(totals.gpay),
      Paytm: num(totals.paytm),
      NEFT: num(totals.neft),
      "Credit Card": num(totals.creditCard),
      "Tally Status": "",
      "Entered At": "",
      "Last Verified At": "",
      "Entered By": "",
      "Last Verified By": "",
    } as any);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Collection");
    const fromLabel = pendingOnly
      ? "Pending"
      : format(parseISO(effectiveFrom), "dd-MM-yyyy");
    const toLabel = pendingOnly
      ? format(new Date(), "dd-MM-yyyy")
      : format(parseISO(effectiveTo), "dd-MM-yyyy");
    XLSX.writeFile(wb, `Daily_Collection_${fromLabel}_to_${toLabel}.xlsx`);
    toast.success("Excel downloaded");
  };

  const loading = isLoading || tallyLoading;

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <CardTitle className="text-base">Daily Collection</CardTitle>
        <p className="text-sm text-muted-foreground">
          Date-wise totals (same Paid/modes as Daily Report). Mark Entered after posting to Tally; if amounts change later the row asks for Reverify. Pending lists every unentered/reverify date (ignores From/To). Current day is never shown.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="acc-from" className="text-xs">From date</Label>
            <Input
              id="acc-from"
              type="date"
              value={effectiveFrom}
              max={latestAllowed}
              onChange={(e) => {
                const v = clampPast(e.target.value, latestAllowed);
                setRangeClamped(v, effectiveTo < v ? v : effectiveTo);
              }}
              className="w-[160px]"
            />
          </div>
          <div>
            <Label htmlFor="acc-to" className="text-xs">To date</Label>
            <Input
              id="acc-to"
              type="date"
              value={effectiveTo}
              max={latestAllowed}
              onChange={(e) => {
                const v = clampPast(e.target.value, latestAllowed);
                setRangeClamped(effectiveFrom > v ? v : effectiveFrom, v);
              }}
              className="w-[160px]"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={!sameDay}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={goNext} disabled={!canGoNext}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={pendingOnly ? "default" : "outline"}
            onClick={() => setPendingOnly((v) => !v)}
          >
            <Filter className="h-4 w-4 mr-1.5" />
            {pendingOnly ? "Show all dates" : `Pending (${pendingCount})`}
          </Button>
          <Button type="button" size="sm" onClick={exportExcel} disabled={loading || displayRows.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export Excel
          </Button>
          {(loading || isFetching) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : displayRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {pendingOnly ? "No pending or reverify dates." : "No dates in this range."}
          </p>
        ) : (
          <div className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total Collection (Paid)</TableHead>
                  <TableHead className="text-right">Cash</TableHead>
                  <TableHead className="text-right">GPay</TableHead>
                  <TableHead className="text-right">Paytm</TableHead>
                  <TableHead className="text-right">NEFT</TableHead>
                  <TableHead className="text-right">Credit Card</TableHead>
                  <TableHead>Tally</TableHead>
                  <TableHead>Timestamps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((r) => {
                  const st = tallyByDay.get(r.dayKey);
                  const ui = uiStatusFor(r, st);
                  return (
                    <TableRow
                      key={r.dayKey}
                      className={cn(
                        ui === "reverify" && "bg-amber-50",
                        ui === "entered" && "bg-emerald-50/60",
                      )}
                    >
                      <TableCell className="font-medium tabular-nums">{r.dateLabel}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${r.paid < 0 ? "text-destructive" : ""}`}>
                        {money(r.paid)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.cash)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.gpay)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.paytm)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.neft)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.creditCard)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              ui === "entered" && "border-emerald-600 text-emerald-700 bg-emerald-50",
                              (ui === "unentered" || ui === "reverify") && "border-amber-600 text-amber-800 bg-amber-50",
                            )}
                          >
                            {tallyStatusLabel(r, st)}
                          </Badge>
                          {ui === "unentered" && (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              disabled={markMutation.isPending}
                              onClick={() => markMutation.mutate({ row: r, mode: "enter" })}
                            >
                              Mark Entered
                            </Button>
                          )}
                          {ui === "reverify" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7"
                              disabled={markMutation.isPending}
                              onClick={() => markMutation.mutate({ row: r, mode: "reverify" })}
                            >
                              Reverify
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {st ? (
                          <div className="leading-snug">
                            <div>Entered: {stamp(st.entered_at)}</div>
                            <div>
                              {st.verify_count > 1 ? "Reverified and entered: " : "Verified: "}
                              {stamp(st.last_verified_at)}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${totals.paid < 0 ? "text-destructive" : ""}`}>
                    {money(num(totals.paid))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(num(totals.cash))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(num(totals.gpay))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(num(totals.paytm))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(num(totals.neft))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(num(totals.creditCard))}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyCollectionReport;
