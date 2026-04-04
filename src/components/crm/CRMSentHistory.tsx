import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { format } from "date-fns";

const CRMSentHistory = () => {
  const [search, setSearch] = useState("");

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["crm-sent-history"],
    queryFn: async () => {
      const BATCH = 900;
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("crm_contacts")
          .select("primary_key, patient_name, mobile_number, last_sent_type, last_sent_date")
          .not("last_sent_date", "is", null)
          .order("last_sent_date", { ascending: false })
          .range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  const filtered = records.filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.patient_name || "").toLowerCase().includes(s) ||
      (r.mobile_number || "").includes(s) ||
      (r.last_sent_type || "").toLowerCase().includes(s)
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sent History ({filtered.length} records)</CardTitle>
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
        ) : filtered.length === 0 ? (
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
                {filtered.map((r: any, i: number) => (
                  <TableRow key={r.primary_key}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
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
      </CardContent>
    </Card>
  );
};

export default CRMSentHistory;
