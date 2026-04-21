import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Download } from "lucide-react";
import { format } from "date-fns";

interface Row {
  id: string;
  registration_id: string;
  invoice_number: string | null;
  registration_date: string | null;
  approval_date: string | null;
  test_results: any;
}

interface Props {
  reports: Row[];
  token: string;
  onDownload: (registrationId: string) => void;
}

const PreviousReportsSection = ({ reports, token, onDownload }: Props) => {
  const [showAll, setShowAll] = useState(false);
  if (!reports || reports.length === 0) return null;
  const visible = showAll ? reports : reports.slice(0, 5);

  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return format(new Date(iso), "dd-MM-yyyy");
    } catch {
      return "—";
    }
  };

  const testCount = (tr: any) => {
    if (!tr) return 0;
    if (Array.isArray(tr)) return tr.length;
    return 0;
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Previous Reports</h3>
        <Badge variant="secondary" className="text-[10px]">
          {reports.length}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Download previously approved reports for this patient.
      </p>
      <div className="divide-y">
        {visible.map((r) => (
          <div key={r.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {fmt(r.registration_date || r.approval_date)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Invoice {r.invoice_number || "—"} · {testCount(r.test_results)} test
                {testCount(r.test_results) === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => onDownload(r.registration_id)}
            >
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          </div>
        ))}
      </div>
      {reports.length > 5 && (
        <div className="mt-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show less" : `Show ${reports.length - 5} more`}
          </Button>
        </div>
      )}
    </Card>
  );
};

export default PreviousReportsSection;
