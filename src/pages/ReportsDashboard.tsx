import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Eye, FileText, Search, RefreshCw, Loader2 } from "lucide-react";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Processing: "bg-blue-100 text-blue-800",
  "Awaiting Review": "bg-orange-100 text-orange-800",
  Completed: "bg-green-100 text-green-800",
};

const ReportsDashboard = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const loadReports = async () => {
    setLoading(true);
    const { data } = await supabase.from("uploaded_reports").select("*").order("created_at", { ascending: false }).limit(200);
    setReports(data || []);
    setLoading(false);
  };

  useEffect(() => { loadReports(); }, []);

  const filtered = reports.filter((r) =>
    (r.patient_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.umr_id || "").toLowerCase().includes(search.toLowerCase()) ||
    ((r as any).reg_no || "").toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: reports.length,
    pending: reports.filter((r) => r.status === "Pending" || r.status === "Processing").length,
    review: reports.filter((r) => r.status === "Awaiting Review").length,
    completed: reports.filter((r) => r.status === "Completed").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports Dashboard</h1>
        <Button onClick={() => navigate("/reports/upload")}><Upload className="h-4 w-4 mr-2" />Upload Report</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-muted-foreground">Total Reports</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold text-yellow-600">{stats.pending}</p><p className="text-sm text-muted-foreground">Processing</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold text-orange-600">{stats.review}</p><p className="text-sm text-muted-foreground">Awaiting Review</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold text-green-600">{stats.completed}</p><p className="text-sm text-muted-foreground">Completed</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Uploaded Reports</CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-64" />
              </div>
              <Button variant="outline" size="icon" onClick={loadReports}><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>UMR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{r.file_name || "Report"}</div>
                    </TableCell>
                    <TableCell>{r.patient_name || "-"}</TableCell>
                    <TableCell>{r.umr_id || "-"}</TableCell>
                    <TableCell><Badge className={statusColors[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.status === "Awaiting Review" && (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/reports/review/${r.id}`)}>Review</Button>
                        )}
                        {r.status === "Completed" && (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/reports/view/${r.id}`)}><Eye className="h-3 w-3 mr-1" />View</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No reports found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportsDashboard;
