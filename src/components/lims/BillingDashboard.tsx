import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, IndianRupee, BellRing, BookOpen, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  getInvoices,
  getCreditPickupPoints,
  setNoReminder,
  deleteInvoice,
  markReminderSent,
  type PickupInvoice,
} from "@/lib/pickupBilling";
import { supabase } from "@/integrations/supabase/client";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import PickupPaymentDialog from "./PickupPaymentDialog";
import PickupLedgerDialog from "./PickupLedgerDialog";
import PickupInvoicePDF from "./PickupInvoicePDF";

const BillingDashboard = () => {
  const qc = useQueryClient();
  useLimsPipelineRealtime("billing");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pickupFilter, setPickupFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [payOpen, setPayOpen] = useState<PickupInvoice | null>(null);
  const [pdfOpen, setPdfOpen] = useState<PickupInvoice | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState<{ id: string; name: string } | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["pickup_invoices", statusFilter, pickupFilter, from, to],
    queryFn: () => getInvoices({
      status: statusFilter,
      pickupPointId: pickupFilter,
      from: from || undefined,
      to: to || undefined,
    }),
  });
  const { data: pickups = [] } = useQuery({ queryKey: ["credit_pickup_points"], queryFn: getCreditPickupPoints });
  const { data: globalReminderDays = 15 } = useQuery({
    queryKey: ["pickup_default_reminder_days"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("setting_value").eq("setting_key", "pickup_invoice_default_reminder_days").maybeSingle();
      return parseInt(data?.setting_value || "15") || 15;
    },
  });

  const pickupMap = useMemo(() => {
    const m = new Map<string, any>();
    pickups.forEach((p) => m.set(p.id, p));
    return m;
  }, [pickups]);

  const isReminderDue = (inv: PickupInvoice) => {
    if (inv.no_reminder || inv.due_amount <= 0) return false;
    const days = inv.reminder_days ?? globalReminderDays;
    const ref = inv.last_reminder_sent_at || inv.created_at;
    return differenceInDays(new Date(), new Date(ref)) >= days;
  };

  const toggleReminder = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setNoReminder(id, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pickup_invoices"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_invoices"] });
      toast.success("Invoice deleted");
    },
  });

  const sendReminder = async (inv: PickupInvoice) => {
    const pickup = pickupMap.get(inv.pickup_point_id);
    if (!pickup?.phone) { toast.error("Pickup point has no phone"); return; }
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("template_value")
      .eq("template_key", "pickup_invoice_reminder")
      .maybeSingle();
    const period = `${format(new Date(inv.period_from), "dd-MM-yyyy")} to ${format(new Date(inv.period_to), "dd-MM-yyyy")}`;
    const overdue = differenceInDays(new Date(), new Date(inv.last_reminder_sent_at || inv.created_at));
    const msg = (tpl?.template_value || "Reminder for invoice {invoice_no} — outstanding ₹{amount}.")
      .split("{pickup_name}").join(pickup.name)
      .split("{invoice_no}").join(inv.invoice_number)
      .split("{amount}").join(inv.due_amount.toFixed(2))
      .split("{period}").join(period)
      .split("{days_overdue}").join(String(overdue));
    shareOnWhatsApp(pickup.phone, msg);
    await markReminderSent(inv.id);
    // message_send_log table dropped — no logging on pickup invoice reminders.
    qc.invalidateQueries({ queryKey: ["pickup_invoices"] });
    toast.success("Reminder opened in WhatsApp");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RefreshButton
          queryKeys={["pickup_invoices", "credit_pickup_points", "pickup_default_reminder_days"]}
        />
      </div>
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pickup Point</Label>
            <Select value={pickupFilter} onValueChange={setPickupFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {pickups.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Period From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>Period To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Pickup Point</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Patients</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>No Rmdr</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6">Loading…</TableCell></TableRow>
              ) : invoices.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">No invoices</TableCell></TableRow>
              ) : invoices.map((inv) => {
                const pp = pickupMap.get(inv.pickup_point_id);
                const dueRem = isReminderDue(inv);
                return (
                  <TableRow key={inv.id} className={dueRem ? "bg-destructive/5" : ""}>
                    <TableCell className="font-mono font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>{pp?.name || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {format(new Date(inv.period_from), "dd-MM-yy")} to {format(new Date(inv.period_to), "dd-MM-yy")}
                    </TableCell>
                    <TableCell className="text-right">{inv.patient_count}</TableCell>
                    <TableCell className="text-right">₹{Number(inv.total_amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right">₹{Number(inv.paid_amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">₹{Number(inv.due_amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={inv.status === "paid" ? "default" : inv.status === "partial" ? "secondary" : "outline"}>
                        {inv.status}
                      </Badge>
                      {dueRem && <Badge variant="destructive" className="ml-1 text-[10px]">Reminder Due</Badge>}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={inv.no_reminder}
                        onCheckedChange={(v) => toggleReminder.mutate({ id: inv.id, value: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" title="View / Download PDF" onClick={() => setPdfOpen(inv)}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Record Payment" onClick={() => setPayOpen(inv)} disabled={inv.due_amount <= 0}>
                          <IndianRupee className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Send Reminder" onClick={() => sendReminder(inv)} disabled={inv.no_reminder || inv.due_amount <= 0}>
                          <BellRing className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Ledger" onClick={() => setLedgerOpen({ id: inv.pickup_point_id, name: pp?.name || "" })}>
                          <BookOpen className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Delete" onClick={() => { if (confirm("Delete this invoice?")) del.mutate(inv.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PickupPaymentDialog
        open={!!payOpen}
        onClose={() => setPayOpen(null)}
        invoiceId={payOpen?.id || null}
        invoiceNumber={payOpen?.invoice_number}
        dueAmount={payOpen?.due_amount}
      />
      <PickupLedgerDialog
        open={!!ledgerOpen}
        onClose={() => setLedgerOpen(null)}
        pickupPointId={ledgerOpen?.id || null}
        pickupPointName={ledgerOpen?.name}
      />
      <PickupInvoicePDF
        open={!!pdfOpen}
        onClose={() => setPdfOpen(null)}
        invoice={pdfOpen}
      />
    </div>
  );
};

export default BillingDashboard;
