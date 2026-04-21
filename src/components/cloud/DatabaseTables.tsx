import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TableStat, RETENTION_RULES, FOREVER_TABLES, invokeFunction } from "@/lib/cloudUsage";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

interface Props {
  tables: TableStat[];
  onRefetch: () => void;
}

const DatabaseTables = ({ tables, onRefetch }: Props) => {
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const runFullPrune = async () => {
    setBusy(true);
    try {
      const data = await invokeFunction("prune-old-logs");
      const summary = Object.entries(data?.results ?? {}).map(
        ([t, r]: any) => `${t}: ${r.deleted}`
      ).join(" · ") || "No rows pruned.";
      toast.success("Prune complete", { description: summary });
      onRefetch();
    } catch (e: any) {
      toast.error("Prune failed", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Database Tables (Top 20)</CardTitle>
        <Button variant="destructive" size="sm" onClick={() => setPwOpen(true)} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
          Run Full Prune Now
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Table</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Rows (est.)</TableHead>
              <TableHead className="text-right">Retention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tables.map((t) => {
              const retention = RETENTION_RULES[t.table_name];
              const forever = FOREVER_TABLES.has(t.table_name);
              return (
                <TableRow key={t.table_name}>
                  <TableCell className="font-mono text-xs">{t.table_name}</TableCell>
                  <TableCell className="text-right">{t.size_pretty}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {t.row_estimate?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {retention ? (
                      <Badge variant="secondary" className="text-[10px]">{retention.days}d</Badge>
                    ) : forever ? (
                      <Badge variant="outline" className="text-[10px]">forever</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <DeletePasswordDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        onSuccess={runFullPrune}
        description="This will permanently delete log rows older than each table's retention window across all 5 logging tables."
      />
    </Card>
  );
};

export default DatabaseTables;
