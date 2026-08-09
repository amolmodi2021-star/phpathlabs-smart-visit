import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const PAGE_SIZE = 50;

const BadDebts = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: count = 0 } = useQuery({
    queryKey: ["lims-bad-debts-count", debouncedSearch],
    queryFn: async () => {
      let q = supabase
        .from("patient_registrations")
        .select("id", { count: "exact", head: true })
        .eq("is_bad_debt", true);
      if (debouncedSearch.trim()) {
        q = q.or(`patient_name.ilike.%${debouncedSearch.trim()}%,mobile_number.ilike.%${debouncedSearch.trim()}%,invoice_number.ilike.%${debouncedSearch.trim()}%`);
      }
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["lims-bad-debts", debouncedSearch, page],
    queryFn: async () => {
      let q = supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, doctor_name, created_at, net_amount, paid_amount, due_amount")
        .eq("is_bad_debt", true)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (debouncedSearch.trim()) {
        q = q.or(`patient_name.ilike.%${debouncedSearch.trim()}%,mobile_number.ilike.%${debouncedSearch.trim()}%,invoice_number.ilike.%${debouncedSearch.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const handleRestore = async (p: any) => {
    try {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ is_bad_debt: false })
        .eq("id", p.id);
      if (error) throw error;
      toast.success("Restored to due payments");
      queryClient.invalidateQueries({ queryKey: ["lims-bad-debts"] });
      queryClient.invalidateQueries({ queryKey: ["lims-bad-debts-count"] });
      queryClient.invalidateQueries({ queryKey: ["lims-due-payments"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to restore");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 max-w-md flex-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, mobile, invoice..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <RefreshButton
          queryKeys={["lims-bad-debts", "lims-bad-debts-count", "lims-due-payments"]}
          className="ml-auto"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : patients.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No bad debts found.</p>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Registration Date</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.invoice_number}</TableCell>
                  <TableCell className="font-medium">{p.patient_name}</TableCell>
                  <TableCell>{p.mobile_number}</TableCell>
                  <TableCell>{p.doctor_name || "-"}</TableCell>
                  <TableCell>{format(new Date(p.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                  <TableCell className="text-right">₹{p.net_amount}</TableCell>
                  <TableCell className="text-right">₹{p.paid_amount}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="destructive">₹{p.due_amount}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => handleRestore(p)}>
                      <Undo2 className="h-3 w-3 mr-1" /> Restore to Due
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages} ({count} total)</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default BadDebts;
