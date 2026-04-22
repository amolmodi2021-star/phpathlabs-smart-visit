import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, RefreshCw } from "lucide-react";
import { format } from "date-fns";

// Hard cap at 100 rows — the UI is for spot-checks, not analytics. Removing the
// `count: "exact"` query and pagination saves a full-table scan + extra round-
// trip on every open. For older message audits use date filters in the DB.
const PAGE_SIZE = 100;

const MessageLog = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["message_send_log", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("message_send_log")
        .select("id, patient_name, mobile_number, umr_number, primary_key, message_type, sent_at, delivered_at, read_at, failed_at")
        .order("sent_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        query = query.or(
          `patient_name.ilike.%${s}%,mobile_number.ilike.%${s}%,message_type.ilike.%${s}%,umr_number.ilike.%${s}%,primary_key.ilike.%${s}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    // Manual refresh only — no auto-refetch on mount, focus, or reconnect.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, mobile, UMR, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh log"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <span className="text-sm text-muted-foreground">
          Showing latest {rows.length} {rows.length === 1 ? "message" : "messages"}
        </span>
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
              <TableHead>Sent Date & Time</TableHead>
              <TableHead>Delivered Date & Time</TableHead>
              <TableHead>Read Date & Time</TableHead>
              <TableHead>Failed Date & Time</TableHead>
              <TableHead>Days Ago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
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
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{row.patient_name || "—"}</TableCell>
                    <TableCell>{row.mobile_number}</TableCell>
                    <TableCell>{row.umr_number || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{row.primary_key || "—"}</TableCell>
                    <TableCell>{row.message_type}</TableCell>
                    <TableCell className="whitespace-nowrap">{format(sentDate, "dd-MM-yyyy hh:mm a")}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.delivered_at ? format(new Date(row.delivered_at), "dd-MM-yyyy hh:mm a") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.read_at ? format(new Date(row.read_at), "dd-MM-yyyy hh:mm a") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.failed_at ? format(new Date(row.failed_at), "dd-MM-yyyy hh:mm a") : "—"}
                    </TableCell>
                    <TableCell className="text-center">{daysAgo}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default MessageLog;
