import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Cloud, Plus, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  invalidateCloudinaryAccountCache,
  type CloudinaryPurpose,
} from "@/lib/cardStorageCloudinary";

type CloudinaryAccount = {
  id: string;
  account_name: string;
  cloud_name: string;
  upload_preset: string;
  api_key: string | null;
  api_secret: string | null;
  is_active: boolean;
  purpose?: string;
};

/**
 * Manage Cloudinary accounts for a given purpose (whatsapp vs outsourced_pdf).
 * Only one account can be active per purpose.
 */
export default function CloudinaryAccountsPanel({
  purpose,
  title,
  description,
}: {
  purpose: CloudinaryPurpose;
  title: string;
  description: string;
}) {
  const [accounts, setAccounts] = useState<CloudinaryAccount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CloudinaryAccount | null>(null);
  const [form, setForm] = useState({ account_name: "", cloud_name: "", upload_preset: "", api_key: "", api_secret: "" });
  const [showSecret, setShowSecret] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("cloudinary_accounts")
      .select("*")
      .eq("purpose", purpose)
      .order("created_at", { ascending: true });
    if (error) {
      // Pre-migration fallback: show all for whatsapp
      if (purpose === "whatsapp") {
        const legacy = await supabase.from("cloudinary_accounts").select("*").order("created_at", { ascending: true });
        setAccounts((legacy.data || []) as CloudinaryAccount[]);
        return;
      }
      toast.error("Failed to load accounts: " + error.message);
      return;
    }
    setAccounts((data || []) as CloudinaryAccount[]);
  };
  useEffect(() => { void load(); }, [purpose]);

  const openAdd = () => {
    setEditing(null);
    setForm({ account_name: "", cloud_name: "", upload_preset: "", api_key: "", api_secret: "" });
    setDialogOpen(true);
  };
  const openEdit = (a: CloudinaryAccount) => {
    setEditing(a);
    setForm({
      account_name: a.account_name,
      cloud_name: a.cloud_name,
      upload_preset: a.upload_preset,
      api_key: a.api_key || "",
      api_secret: a.api_secret || "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.account_name.trim() || !form.cloud_name.trim() || !form.upload_preset.trim()) {
      toast.error("Account name, cloud name and upload preset are required");
      return;
    }
    const payload: any = {
      account_name: form.account_name.trim(),
      cloud_name: form.cloud_name.trim(),
      upload_preset: form.upload_preset.trim(),
      api_key: form.api_key.trim() || null,
      api_secret: form.api_secret.trim() || null,
      purpose,
    };
    const { error } = editing
      ? await supabase.from("cloudinary_accounts").update(payload).eq("id", editing.id)
      : await supabase.from("cloudinary_accounts").insert(payload);
    if (error) { toast.error("Save failed: " + error.message); return; }
    setDialogOpen(false);
    invalidateCloudinaryAccountCache();
    await load();
    toast.success(editing ? "Account updated" : "Account added");
  };

  const activate = async (id: string) => {
    const { error: e1 } = await supabase
      .from("cloudinary_accounts")
      .update({ is_active: false })
      .eq("purpose", purpose);
    if (e1) { toast.error("Activate failed: " + e1.message); return; }
    const { error: e2 } = await supabase.from("cloudinary_accounts").update({ is_active: true }).eq("id", id);
    if (e2) { toast.error("Activate failed: " + e2.message); return; }
    invalidateCloudinaryAccountCache();
    await load();
    toast.success("Active account updated");
  };

  const remove = async (a: CloudinaryAccount) => {
    if (a.is_active) { toast.error("Activate a different account first"); return; }
    if (!confirm(`Delete "${a.account_name}"?`)) return;
    const { error } = await supabase.from("cloudinary_accounts").delete().eq("id", a.id);
    if (error) { toast.error("Delete failed: " + error.message); return; }
    invalidateCloudinaryAccountCache();
    await load();
    toast.success("Deleted");
  };

  const test = async (a: CloudinaryAccount) => {
    try {
      const resource = purpose === "outsourced_pdf" ? "raw" : "image";
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      const fd = new FormData();
      fd.append("file", blob, purpose === "outsourced_pdf" ? "probe.pdf" : "probe.png");
      fd.append("upload_preset", a.upload_preset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud_name}/${resource}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        // Fallback image upload if raw preset rejects
        const fd2 = new FormData();
        fd2.append("file", blob);
        fd2.append("upload_preset", a.upload_preset);
        const res2 = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud_name}/image/upload`, { method: "POST", body: fd2 });
        if (!res2.ok) {
          const j = await res2.json().catch(() => ({} as any));
          throw new Error(j?.error?.message || `HTTP ${res2.status}`);
        }
      }
      toast.success(`✓ ${a.account_name} works`);
    } catch (e: any) {
      toast.error(`Test failed: ${e?.message || "Unknown"}`);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Cloud className="h-4 w-4" /> {title}</CardTitle>
        <Button size="sm" onClick={openAdd} className="h-8"><Plus className="h-3.5 w-3.5 mr-1" /> Add Account</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Active</TableHead>
                <TableHead className="h-9">Name</TableHead>
                <TableHead className="h-9">Cloud Name</TableHead>
                <TableHead className="h-9">Upload Preset</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">No accounts yet.</TableCell></TableRow>
              )}
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="py-2">
                    {a.is_active ? (
                      <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Active</Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => activate(a.id)}>Activate</Button>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-sm font-medium">{a.account_name}</TableCell>
                  <TableCell className="py-2 text-sm font-mono">{a.cloud_name}</TableCell>
                  <TableCell className="py-2 text-sm font-mono">{a.upload_preset}</TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => test(a)}>Test</Button>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(a)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => remove(a)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Cloudinary Account" : "Add Cloudinary Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Account Name</Label>
              <Input value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Cloud Name</Label>
              <Input value={form.cloud_name} onChange={(e) => setForm((f) => ({ ...f, cloud_name: e.target.value }))} className="h-9 font-mono" />
            </div>
            <div>
              <Label className="text-xs">Upload Preset (unsigned)</Label>
              <Input value={form.upload_preset} onChange={(e) => setForm((f) => ({ ...f, upload_preset: e.target.value }))} className="h-9 font-mono" />
            </div>
            <div>
              <Label className="text-xs">API Key (optional)</Label>
              <Input value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} className="h-9 font-mono" />
            </div>
            <div>
              <Label className="text-xs">API Secret (optional)</Label>
              <div className="flex gap-2">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={form.api_secret}
                  onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))}
                  className="h-9 font-mono"
                />
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => setShowSecret((s) => !s)}>
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
