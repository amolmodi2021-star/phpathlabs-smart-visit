import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 50;

const MessageLog = () => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["message_send_log", search, page],
    queryFn: async () => {
      let query = supabase
        .from("message_send_log")
        .select("*", { count: "exact" })
        .order("sent_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(
          `patient_name.ilike.%${search.trim()}%,mobile_number.ilike.%${search.trim()}%,message_type.ilike.%${search.trim()}%,umr_number.ilike.%${search.trim()}%,primary_key.ilike.%${search.trim()}%`
        );
      }

      const { data: rows, count, error } = await query;
      if (error) throw error;
      return { rows: rows || [], total: count || 0 };
    },
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, mobile, UMR, or type..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} records</span>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Patient Name</TableHead>
              <TableHead>Mobile Number</TableHead>
              <TableHead>UMR Number</TableHead>
              <TableHead>Primary Key</TableHead>
              <TableHead>Message Type</TableHead>
              <TableHead>Sent Date</TableHead>
              <TableHead>Sent Time</TableHead>
              <TableHead>Days Ago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No messages logged yet
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row: any, idx: number) => {
                const sentDate = new Date(row.sent_at);
                const now = new Date();
                const diffMs = now.getTime() - sentDate.getTime();
                const daysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">
                      {page * PAGE_SIZE + idx + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.patient_name || "—"}
                    </TableCell>
                    <TableCell>{row.mobile_number}</TableCell>
                    <TableCell>{row.umr_number || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{row.primary_key || "—"}</TableCell>
                    <TableCell>{row.message_type}</TableCell>
                    <TableCell>{format(sentDate, "dd-MM-yyyy")}</TableCell>
                    <TableCell>{format(sentDate, "hh:mm a")}</TableCell>
                    <TableCell className="text-center">{daysAgo}</TableCell>
                    <TableCell>{format(sentDate, "hh:mm a")}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

export default MessageLog;
