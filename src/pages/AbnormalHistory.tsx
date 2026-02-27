import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Send, Trash2, Search } from "lucide-react";
import { parseExcelFile } from "@/lib/excel";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";

const AbnormalHistory = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["abnormal_history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("abnormal_history")
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const rows = await parseExcelFile(file);
      if (rows.length === 0) throw new Error("No data found in file");

      // Get column keys (first two columns)
      const keys = Object.keys(rows[0]);
      if (keys.length < 2) throw new Error("Excel must have at least 2 columns: Mobile Number and Message");

      const mobileKey = keys[0];
      const messageKey = keys[1];

      const inserts = rows
        .filter((r) => r[mobileKey] && r[messageKey])
        .map((r) => {
          const raw = String(r[mobileKey]).replace(/\D/g, "");
          const mobile = raw.slice(-10);
          return { mobile_number: mobile, message: String(r[messageKey]) };
        })
        .filter((r) => r.mobile_number.length === 10);

      if (inserts.length === 0) throw new Error("No valid records found");

      // Delete existing unsent records for these mobile numbers and re-insert
      const mobiles = [...new Set(inserts.map((i) => i.mobile_number))];
      await supabase.from("abnormal_history").delete().in("mobile_number", mobiles).eq("sent", false);

      const { error } = await supabase.from("abnormal_history").insert(inserts);
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ["abnormal_history"] });
      toast.success(`Uploaded ${inserts.length} records`);
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const sendMessage = useMutation({
    mutationFn: async ({ id, mobile, message }: { id: string; mobile: string; message: string }) => {
      shareOnWhatsApp(mobile, message);
      const { error } = await supabase
        .from("abnormal_history")
        .update({ sent: true, sent_at: new Date().toISOString(), sent_context: "manual" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abnormal_history"] });
      toast.success("Message sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("abnormal_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abnormal_history"] });
      toast.success("All records deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = records.filter((r: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.mobile_number.includes(q) || r.message.toLowerCase().includes(q);
  });

  const unsentCount = records.filter((r: any) => !r.sent).length;
  const sentCount = records.filter((r: any) => r.sent).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Abnormal History</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={() => deleteAll.mutate()} disabled={records.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" />Delete All
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-xs">
        <span className="bg-muted px-2 py-1 rounded">Total: {records.length}</span>
        <span className="bg-warning/20 text-warning-foreground px-2 py-1 rounded">Unsent: {unsentCount}</span>
        <span className="bg-success/20 text-success-foreground px-2 py-1 rounded">Sent: {sentCount}</span>
      </div>

      {/* Upload */}
      <div>
        <Label className="text-sm font-medium">Upload Excel (Column A: Mobile, Column B: Message)</Label>
        <div className="mt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <Button size="sm" variant="outline" asChild disabled={uploading}>
              <span><Upload className="h-4 w-4 mr-1" />{uploading ? "Uploading..." : "Choose File"}</span>
            </Button>
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by mobile number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Records */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No records found.</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map((r: any) => (
            <Card key={r.id} className={`glass-card ${r.sent ? "opacity-60" : ""}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{r.mobile_number}</span>
                      {r.sent && (
                        <span className="text-[10px] bg-success/20 text-success-foreground px-1.5 py-0.5 rounded">
                          Sent {r.sent_context ? `(${r.sent_context})` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{r.message}</p>
                  </div>
                  {!r.sent && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendMessage.mutate({ id: r.id, mobile: r.mobile_number, message: r.message })}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />Send
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AbnormalHistory;
