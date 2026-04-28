import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableStat, RETENTION_RULES, FOREVER_TABLES } from "@/lib/cloudUsage";

interface Props {
  tables: TableStat[];
  onRefetch: () => void;
}

const DatabaseTables = ({ tables }: Props) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Database Tables (Top 20)</CardTitle>
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
    </Card>
  );
};

export default DatabaseTables;
