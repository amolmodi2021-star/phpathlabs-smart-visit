import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";

const PAGE_SIZE = 50;

const MarketingHistory = () => {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, []);

  const { data: pagedData } = useQuery({
    queryKey: ["marketing_campaigns", page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await supabase
        .from("marketing_campaigns")
        .select("*, marketing_templates(template_name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data || []) as any[], total: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const campaigns = pagedData?.rows || [];
  const total = pagedData?.total || 0;

  const statusColor = (status: string) => {
    if (status === "completed") return "default";
    if (status === "completed_with_errors") return "destructive";
    if (status === "sending") return "secondary";
    return "outline";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campaign History</CardTitle>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No campaigns yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">{format(new Date(c.created_at), "dd-MM-yyyy hh:mm a")}</TableCell>
                  <TableCell className="font-medium">{c.marketing_templates?.template_name || "—"}</TableCell>
                  <TableCell>{c.total_messages}</TableCell>
                  <TableCell className="text-primary">{c.sent_count}</TableCell>
                  <TableCell className="text-destructive">{c.failed_count}</TableCell>
                  <TableCell><Badge variant={statusColor(c.status) as any}>{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
};

export default MarketingHistory;
