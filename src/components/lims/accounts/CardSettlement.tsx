import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  getOpenCardClearingBalance,
  getTallySettings,
  listCardSettlements,
  pushCardSettlementToTally,
  saveCardSettlement,
} from "@/lib/tallyIntegration";

const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function CardSettlement() {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [gross, setGross] = useState("");
  const [bankReceived, setBankReceived] = useState("");
  const [bankLedger, setBankLedger] = useState("");
  const [settlementDate, setSettlementDate] = useState(today);
  const [dayKey, setDayKey] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const { data: openBal, isLoading: openLoading } = useQuery({
    queryKey: ["tally_open_card_clearing"],
    queryFn: getOpenCardClearingBalance,
  });

  const { data: settings } = useQuery({
    queryKey: ["accounts_tally_settings"],
    queryFn: getTallySettings,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["accounts_tally_card_settlements"],
    queryFn: listCardSettlements,
  });

  const mdrPreview = useMemo(() => {
    const g = Number(gross);
    const b = Number(bankReceived);
    if (!Number.isFinite(g) || !Number.isFinite(b)) return null;
    return num(g - b);
  }, [gross, bankReceived]);

  const fillOpen = () => {
    if (!openBal) return;
    setGross(String(openBal.openGross));
    if (settings?.default_settlement_bank_ledger) {
      setBankLedger(settings.default_settlement_bank_ledger);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCardSettlement({
        dayKey: dayKey || null,
        gross: Number(gross),
        bankReceived: Number(bankReceived),
        bankLedger: bankLedger || settings?.default_settlement_bank_ledger || "",
        settlementDate,
        referenceNo,
        notes,
      }),
    onSuccess: () => {
      toast.success("Settlement saved — push to Tally when ready");
      setGross("");
      setBankReceived("");
      setReferenceNo("");
      setNotes("");
      setDayKey("");
      qc.invalidateQueries({ queryKey: ["accounts_tally_card_settlements"] });
      qc.invalidateQueries({ queryKey: ["tally_open_card_clearing"] });
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const pushMutation = useMutation({
    mutationFn: (id: string) => pushCardSettlementToTally(id),
    onSuccess: () => {
      toast.success("Settlement queued for Tally bridge");
      qc.invalidateQueries({ queryKey: ["accounts_tally_card_settlements"] });
      qc.invalidateQueries({ queryKey: ["accounts_tally_voucher_outbox"] });
    },
    onError: (e: Error) => toast.error(e.message || "Push failed"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Card Settlement</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter the amount actually credited to bank. MDR is calculated as gross − received (no fixed %). Then
            push the settlement voucher to Tally.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Open clearing</div>
              <div className="font-semibold tabular-nums">
                {openLoading ? "…" : money(openBal?.openGross || 0)}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Pushed card gross</div>
              <div className="tabular-nums">{money(openBal?.pushedGross || 0)}</div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Already settled</div>
              <div className="tabular-nums">{money(openBal?.settledGross || 0)}</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={fillOpen} disabled={!openBal?.openGross}>
              Use full open balance
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Gross (from clearing)</Label>
              <Input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Amount received in bank</Label>
              <Input
                type="number"
                step="0.01"
                value={bankReceived}
                onChange={(e) => setBankReceived(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">MDR (auto)</Label>
              <Input readOnly value={mdrPreview == null ? "" : mdrPreview.toFixed(2)} className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Bank ledger in Tally</Label>
              <Input
                value={bankLedger}
                onChange={(e) => setBankLedger(e.target.value)}
                placeholder={settings?.default_settlement_bank_ledger || "e.g. HDFC Current"}
              />
            </div>
            <div>
              <Label className="text-xs">Settlement date</Label>
              <Input type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Collection day (optional)</Label>
              <Input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">UTR / Reference</Label>
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !gross || bankReceived === ""}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save settlement
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Settlement history</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No settlements yet.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Settled on</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Bank received</TableHead>
                    <TableHead className="text-right">MDR</TableHead>
                    <TableHead>Bank ledger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums">{r.settlement_date}</TableCell>
                      <TableCell className="tabular-nums">{r.day_key || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.bank_received)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.mdr)}</TableCell>
                      <TableCell>{r.bank_ledger}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {(r.status === "saved" || r.status === "failed") && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-7"
                            disabled={pushMutation.isPending}
                            onClick={() => pushMutation.mutate(r.id)}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Push to Tally
                          </Button>
                        )}
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
}
