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

const NewNumbers = () => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["new_numbers", search, page],
    queryFn: async () => {
      // Get all CRM mobile numbers
      const { data: crmMobiles } = await supabase
        .from("crm_contacts")
        .select("mobile_number");

      const crmSet = new Set(
        (crmMobiles || [])
          .map((c: any) => (c.mobile_number || "").replace(/\D/g, "").slice(-10))
          .filter((m: string) => m.length === 10)
      );

      // Get all blacklisted numbers
      const { data: blacklisted } = await supabase
        .from("crm_blacklist")
        .select("mobile_number");

      const blacklistSet = new Set(
        (blacklisted || [])
          .map((b: any) => (b.mobile_number || "").replace(/\D/g, "").slice(-10))
          .filter((m: string) => m.length === 10)
      );

      // Get all log entries
      let query = supabase
        .from("message_send_log")
        .select("*")
        .order("sent_at", { ascending: false });

      const { data: allLogs } = await query;

      // Filter to numbers not in CRM and group
      const grouped = new Map<string, {
        mobile: string;
        patientName: string | null;
        lastType: string;
        lastSent: string;
        count: number;
      }>();

      for (const log of allLogs || []) {
        const mob = (log.mobile_number || "").replace(/\D/g, "").slice(-10);
        if (!mob || mob.length !== 10) continue;
        if (crmSet.has(mob)) continue;
        if (blacklistSet.has(mob)) continue;

        if (!grouped.has(mob)) {
          grouped.set(mob, {
            mobile: mob,
            patientName: log.patient_name,
            lastType: log.message_type,
            lastSent: log.sent_at,
            count: 1,
          });
        } else {
          grouped.get(mob)!.count++;
        }
      }

      let rows = Array.from(grouped.values());

      // Apply search filter
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.mobile.includes(s) ||
            (r.patientName || "").toLowerCase().includes(s) ||
            r.lastType.toLowerCase().includes(s)
        );
      }

      const total = rows.length;
      const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      return { rows: paged, total };
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
            placeholder="Search mobile, name, or type..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} new numbers</span>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Mobile Number</TableHead>
              <TableHead>Patient Name</TableHead>
              <TableHead>Last Message Type</TableHead>
              <TableHead>Last Sent Date</TableHead>
              <TableHead className="text-center">Messages Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No new numbers found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={row.mobile}>
                  <TableCell className="text-muted-foreground">
                    {page * PAGE_SIZE + idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{row.mobile}</TableCell>
                  <TableCell>{row.patientName || "—"}</TableCell>
                  <TableCell>{row.lastType}</TableCell>
                  <TableCell>{format(new Date(row.lastSent), "dd-MM-yyyy hh:mm a")}</TableCell>
                  <TableCell className="text-center">{row.count}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

export default NewNumbers;
