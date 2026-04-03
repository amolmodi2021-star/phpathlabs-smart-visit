import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const MarketingHistory = () => {
  const { data: campaigns = [] } = useQuery({
    queryKey: ["marketing_campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .select("*, marketing_templates(template_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

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
                  <TableCell className="text-green-600">{c.sent_count}</TableCell>
                  <TableCell className="text-destructive">{c.failed_count}</TableCell>
                  <TableCell><Badge variant={statusColor(c.status) as any}>{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default MarketingHistory;
