import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getCreditPickupPoints,
  getEligibleRegistrations,
  generateInvoicesForPickups,
  defaultPreviousMonthRange,
} from "@/lib/pickupBilling";

const BillingGenerate = () => {
  const qc = useQueryClient();
  const def = defaultPreviousMonthRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string>("");

  const { data: pickups = [] } = useQuery({
    queryKey: ["credit_pickup_points"],
    queryFn: getCreditPickupPoints,
  });

  // Default: select all on first load
  useMemo(() => {
    if (selected.size === 0 && pickups.length > 0) {
      setSelected(new Set(pickups.map((p) => p.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickups]);

  const { data: previewRegs = [], isFetching: loadingPreview } = useQuery({
    queryKey: ["eligible_regs", previewId, from, to],
    queryFn: () => getEligibleRegistrations(previewId, from, to),
    enabled: !!previewId && !!from && !!to,
  });

  const generate = useMutation({
    mutationFn: () => generateInvoicesForPickups(Array.from(selected), from, to),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pickup_invoices"] });
      qc.invalidateQueries({ queryKey: ["eligible_regs"] });
      toast.success(`${res.created} invoice(s) created${res.skipped ? `, ${res.skipped} skipped (no eligible registrations)` : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === pickups.length) setSelected(new Set());
    else setSelected(new Set(pickups.map((p) => p.id)));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RefreshButton queryKeys={["credit_pickup_points", "eligible_regs", "pickup_invoices"]} />
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => generate.mutate()}
                disabled={generate.isPending || selected.size === 0}
              >
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Generate {selected.size} Invoice(s)
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Default range is the previous calendar month. Only credit pickup points are listed.
            Registrations already invoiced are excluded automatically.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === pickups.length && pickups.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Pickup Point</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pickups.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No active credit pickup points</TableCell></TableRow>
              ) : pickups.map((pp) => (
                <TableRow key={pp.id}>
                  <TableCell><Checkbox checked={selected.has(pp.id)} onCheckedChange={() => toggle(pp.id)} /></TableCell>
                  <TableCell className="font-medium">{pp.name}</TableCell>
                  <TableCell>{pp.contact_person || "—"}</TableCell>
                  <TableCell>{pp.phone || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setPreviewId(previewId === pp.id ? "" : pp.id)}>
                      {previewId === pp.id ? "Hide" : "Preview"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {previewId && (
        <Card>
          <CardContent className="p-4">
            <div className="font-semibold mb-2">
              Eligible Registrations — {pickups.find((p) => p.id === previewId)?.name}
            </div>
            {loadingPreview ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : previewRegs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No eligible (un-invoiced) registrations in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Tests</TableHead>
                    <TableHead className="text-right">Net (₹)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRegs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.created_at.slice(0, 10)}</TableCell>
                      <TableCell>{r.invoice_number}</TableCell>
                      <TableCell>{r.patient_name}</TableCell>
                      <TableCell className="text-xs">
                        {Array.isArray(r.tests) ? r.tests.map((t: any) => t.test_name).join(", ") : ""}
                      </TableCell>
                      <TableCell className="text-right">{Number(r.final_amount || r.net_amount || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">
                      ₹{previewRegs.reduce((s, r) => s + Number(r.final_amount || r.net_amount || 0), 0).toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BillingGenerate;
