import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, parseISO, addDays, eachDayOfInterval } from "date-fns";
import * as XLSX from "@e965/xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Loader2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { isHiddenDailyReportType, paymentRowPaid } from "@/lib/dailyReportMetrics";

type DayRow = {
  dayKey: string; // yyyy-MM-dd
  dateLabel: string; // dd-MM-yyyy
  paid: number;
  cash: number;
  gpay: number;
  paytm: number;
  neft: number;
  creditCard: number;
};

const money = (n: number) =>
  n < 0 ? `−₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Accountant view: one row per date — Paid + modes (same rules as Daily Report). */
const DailyCollectionReport = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const { data: transactions = [], isLoading, isFetching } = useQuery({
    queryKey: ["accounts_daily_collection", dateFrom, dateTo],
    queryFn: async () => {
      const from = startOfDay(parseISO(dateFrom)).toISOString();
      const to = endOfDay(parseISO(dateTo)).toISOString();
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

  const dayRows: DayRow[] = useMemo(() => {
    const byDay = new Map<string, DayRow>();

    const ensure = (dayKey: string): DayRow => {
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

    // Prefill every calendar day in range so blank days show ₹0
    try {
      const days = eachDayOfInterval({
        start: parseISO(dateFrom),
        end: parseISO(dateTo),
      });
      days.forEach((d) => ensure(format(d, "yyyy-MM-dd")));
    } catch {
      // invalid range — skip prefill
    }

    for (const t of transactions) {
      if (isHiddenDailyReportType(t.transaction_type)) continue;
      const dayKey = format(parseISO(t.transaction_date), "yyyy-MM-dd");
      const row = ensure(dayKey);
      row.paid += paymentRowPaid(t);
      row.cash += Number(t.cash_amount || 0);
      row.gpay += Number(t.gpay_amount || 0);
      row.paytm += Number(t.paytm_amount || 0);
      row.neft += Number(t.neft_amount || 0);
      row.creditCard += Number(t.credit_card_amount || 0);
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
  }, [transactions, dateFrom, dateTo]);

  const totals = useMemo(
    () =>
      dayRows.reduce(
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
    [dayRows],
  );

  const sameDay = dateFrom === dateTo;

  const goPrev = () => {
    if (!sameDay) {
      toast.message("Previous works when From and To are the same date");
      return;
    }
    const prev = format(addDays(parseISO(dateFrom), -1), "yyyy-MM-dd");
    setDateFrom(prev);
    setDateTo(prev);
  };

  const goNext = () => {
    if (!sameDay) {
      toast.message("Next works when From and To are the same date");
      return;
    }
    const next = format(addDays(parseISO(dateFrom), 1), "yyyy-MM-dd");
    setDateFrom(next);
    setDateTo(next);
  };

  const exportExcel = () => {
    if (dayRows.length === 0) {
      toast.error("No data to export");
      return;
    }
    const rows = dayRows.map((r) => ({
      Date: r.dateLabel,
      "Total Collection (Paid)": r.paid,
      Cash: r.cash,
      GPay: r.gpay,
      Paytm: r.paytm,
      NEFT: r.neft,
      "Credit Card": r.creditCard,
    }));
    rows.push({
      Date: "TOTAL",
      "Total Collection (Paid)": num(totals.paid),
      Cash: num(totals.cash),
      GPay: num(totals.gpay),
      Paytm: num(totals.paytm),
      NEFT: num(totals.neft),
      "Credit Card": num(totals.creditCard),
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Collection");
    const fromLabel = format(parseISO(dateFrom), "dd-MM-yyyy");
    const toLabel = format(parseISO(dateTo), "dd-MM-yyyy");
    XLSX.writeFile(wb, `Daily_Collection_${fromLabel}_to_${toLabel}.xlsx`);
    toast.success("Excel downloaded");
  };

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <CardTitle className="text-base">Daily Collection</CardTitle>
        <p className="text-sm text-muted-foreground">
          Date-wise totals only (same Paid and payment modes as Daily Report). No patient list.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="acc-from" className="text-xs">From date</Label>
            <Input
              id="acc-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                const v = e.target.value;
                setDateFrom(v);
                if (v > dateTo) setDateTo(v);
              }}
              className="w-[160px]"
            />
          </div>
          <div>
            <Label htmlFor="acc-to" className="text-xs">To date</Label>
            <Input
              id="acc-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                const v = e.target.value;
                setDateTo(v);
                if (v < dateFrom) setDateFrom(v);
              }}
              className="w-[160px]"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={!sameDay}
            title={sameDay ? "Go to previous day" : "Set From and To to the same date to use Previous"}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!sameDay}
            title={sameDay ? "Go to next day" : "Set From and To to the same date to use Next"}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button type="button" size="sm" onClick={exportExcel} disabled={isLoading || dayRows.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export Excel
          </Button>
          {(isLoading || isFetching) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayRows.map((r) => (
                  <TableRow key={r.dayKey}>
                    <TableCell className="font-medium tabular-nums">{r.dateLabel}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${r.paid < 0 ? "text-destructive" : ""}`}>
                      {money(r.paid)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.gpay)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.paytm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.neft)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.creditCard)}</TableCell>
                  </TableRow>
                ))}
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
