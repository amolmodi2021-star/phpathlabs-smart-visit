import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";

const CRMAbnormalTests = () => {
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["crm-abnormal-tests", search],
    queryFn: async () => {
      let q = supabase.from("crm_abnormal_tests").select("*").order("created_at", { ascending: false }).limit(200);
      if (search) q = q.or(`contact_primary_key.ilike.%${search}%,test_name.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await parseExcelFile(file);
      const mapped = rows.map((r) => {
        const keys = Object.keys(r);
        return {
          contact_primary_key: String(r[keys[0]] || "").trim(),
          test_name: String(r[keys[1]] || "").trim(),
          test_date: String(r[keys[2]] || "").trim(),
          result_value: String(r[keys[3]] || "").trim(),
          normal_range: String(r[keys[4]] || "").trim(),
        };
      }).filter((m) => m.contact_primary_key && m.test_name);

      if (!mapped.length) { toast.error("No valid rows found"); return; }

      const BATCH = 100;
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("crm_abnormal_tests").insert(mapped.slice(i, i + BATCH));
        if (error) console.error(error);
      }
      toast.success(`Imported ${mapped.length} abnormal test records`);
      qc.invalidateQueries({ queryKey: ["crm-abnormal-tests"] });
    } catch { toast.error("Failed to parse file"); }
    finally { setImporting(false); e.target.value = ""; }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Upload Abnormal Test Data</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Excel columns: Primary Key, Test Name, Date, Result Value, Normal Range
          </p>
          <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} />
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by primary key or test name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>

      <div className="border rounded-lg overflow-auto max-h-[50vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Primary Key</TableHead>
              <TableHead>Test Name</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Normal Range</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : tests.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">No abnormal tests found.</TableCell></TableRow>
            ) : tests.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.contact_primary_key}</TableCell>
                <TableCell>{t.test_name}</TableCell>
                <TableCell>{t.test_date}</TableCell>
                <TableCell>{t.result_value}</TableCell>
                <TableCell>{t.normal_range}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CRMAbnormalTests;
