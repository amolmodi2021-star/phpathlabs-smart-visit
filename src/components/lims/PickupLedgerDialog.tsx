import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInvoiceLedger } from "@/lib/pickupBilling";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onClose: () => void;
  pickupPointId: string | null;
  pickupPointName?: string;
}

const PickupLedgerDialog = ({ open, onClose, pickupPointId, pickupPointName }: Props) => {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["pickup_ledger", pickupPointId],
    queryFn: () => getInvoiceLedger(pickupPointId!),
    enabled: !!pickupPointId && open,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ledger {pickupPointName ? `— ${pickupPointName}` : ""}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No entries</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.date ? format(new Date(r.date), "dd-MM-yyyy") : ""}</TableCell>
                  <TableCell>{r.voucher_type}</TableCell>
                  <TableCell className="text-xs">{r.voucher_no}</TableCell>
                  <TableCell className="text-right">{r.debit ? `₹${r.debit.toFixed(2)}` : ""}</TableCell>
                  <TableCell className="text-right">{r.credit ? `₹${r.credit.toFixed(2)}` : ""}</TableCell>
                  <TableCell className="text-right font-medium">₹{r.balance.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PickupLedgerDialog;
