import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { format } from "date-fns";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";

const PAGE_SIZE = 50;

const CRMSentHistory = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data: pagedData, isLoading } = useQuery({
    queryKey: ["crm-sent-history", debouncedSearch, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from("crm_contacts")
        .select("primary_key, patient_name, mobile_number, last_sent_type, last_sent_date", { count: "estimated" })
        .not("last_sent_date", "is", null)
        .order("last_sent_date", { ascending: false })
        .range(from, to);
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        q = q.or(`patient_name.ilike.%${s}%,mobile_number.ilike.%${s}%,last_sent_type.ilike.%${s}%`);
      }
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as any[], total: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const records = pagedData?.rows || [];
  const total = pagedData?.total || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sent History ({total.toLocaleString()} records)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, mobile, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sent records found.</p>
        ) : (
          <div className="overflow-auto max-h-[60vh] border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Sent Type</TableHead>
                  <TableHead>Sent Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r: any, i: number) => (
                  <TableRow key={r.primary_key}>
                    <TableCell className="text-muted-foreground">{page * PAGE_SIZE + i + 1}</TableCell>
                    <TableCell>{r.patient_name || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{r.mobile_number || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.last_sent_type || "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.last_sent_date
                        ? format(new Date(r.last_sent_date), "dd-MM-yyyy hh:mm a")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
};

export default CRMSentHistory;
