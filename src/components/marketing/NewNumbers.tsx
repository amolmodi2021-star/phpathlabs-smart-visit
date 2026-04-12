import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 50;

const NewNumbers = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["new_numbers", debouncedSearch, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_new_numbers_paginated", {
        p_search: debouncedSearch,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return data as Array<{
        mobile: string;
        patient_name: string | null;
        last_message_type: string;
        last_sent_at: string;
        message_count: number;
        total_count: number;
      }>;
    },
  });

  const rows = data || [];
  const total = rows.length > 0 ? rows[0].total_count : 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search mobile, name, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
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
                  <TableCell>{row.patient_name || "—"}</TableCell>
                  <TableCell>{row.last_message_type}</TableCell>
                  <TableCell>{format(new Date(row.last_sent_at), "dd-MM-yyyy hh:mm a")}</TableCell>
                  <TableCell className="text-center">{row.message_count}</TableCell>
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
