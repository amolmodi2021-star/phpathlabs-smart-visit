import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Upload } from "lucide-react";

const SignatureManagement = () => {
  const [signatures, setSignatures] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ pathologist_name: "", designation: "", qualification: "", mapped_user_id: "" });
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [{ data: sigs }, { data: appUsers }] = await Promise.all([
      supabase.from("pathologist_signatures").select("*").order("created_at"),
      supabase.from("app_users").select("id, username, display_name, is_active").order("display_name"),
    ]);
    setSignatures(sigs || []);
    setUsers(appUsers || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.pathologist_name.trim()) return;
    setSaving(true);
    let sigPath = "";

    if (sigFile) {
      const path = `sigs/${Date.now()}_${sigFile.name}`;
      const { error } = await supabase.storage.from("signatures").upload(path, sigFile);
      if (error) { toast({ title: "Upload failed", variant: "destructive" }); setSaving(false); return; }
      sigPath = path;
    }

    const payload: any = {
      pathologist_name: form.pathologist_name,
      designation: form.designation,
      qualification: form.qualification,
      mapped_user_id: form.mapped_user_id || null,
    };
    if (sigPath) payload.signature_image_path = sigPath;

    if (editId) {
      await supabase.from("pathologist_signatures").update(payload).eq("id", editId);
    } else {
      await supabase.from("pathologist_signatures").insert(payload);
    }

    setDialogOpen(false);
    setEditId(null);
    setSigFile(null);
    setSaving(false);
    load();
    toast({ title: editId ? "Pathologist updated" : "Pathologist added" });
  };

  const handleEdit = (s: any) => {
    setEditId(s.id);
    setForm({
      pathologist_name: s.pathologist_name,
      designation: s.designation || "",
      qualification: s.qualification || "",
      mapped_user_id: s.mapped_user_id || "",
    });
    setSigFile(null);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this pathologist?")) return;
    await supabase.from("pathologist_signatures").delete().eq("id", id);
    load();
  };

  const getSignatureUrl = (path: string) => supabase.storage.from("signatures").getPublicUrl(path).data.publicUrl;

  const getUserName = (userId: string | null) => {
    if (!userId) return "-";
    const u = users.find((u) => u.id === userId);
    return u ? (u.display_name || u.username) : "-";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pathologist Signature Management</h1>
        <Button onClick={() => { setEditId(null); setForm({ pathologist_name: "", designation: "", qualification: "", mapped_user_id: "" }); setSigFile(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Add Pathologist
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signature</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Qualification</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Mapped User</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signatures.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      {s.signature_image_path ? (
                        <img src={getSignatureUrl(s.signature_image_path)} alt="Signature" className="h-10 max-w-[120px] object-contain" />
                      ) : <span className="text-muted-foreground text-sm">No signature</span>}
                    </TableCell>
                    <TableCell className="font-medium">{s.pathologist_name}</TableCell>
                    <TableCell>{s.qualification || "-"}</TableCell>
                    <TableCell>{s.designation || "-"}</TableCell>
                    <TableCell>{getUserName(s.mapped_user_id)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(s)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {signatures.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No pathologists added yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Pathologist</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Pathologist Name *</Label><Input value={form.pathologist_name} onChange={(e) => setForm({ ...form, pathologist_name: e.target.value })} /></div>
            <div><Label>Qualification</Label><Input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="e.g. MD Pathology" /></div>
            <div><Label>Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Consultant Pathologist" /></div>
            <div>
              <Label>Mapped User</Label>
              <Select value={form.mapped_user_id} onValueChange={(v) => setForm({ ...form, mapped_user_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Select user (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {users.filter((u) => u.is_active).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.display_name || u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Signature Image</Label>
              <div className="mt-1">
                <label className="flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer hover:bg-muted">
                  <Upload className="h-4 w-4" />
                  <span className="text-sm">{sigFile ? sigFile.name : "Choose signature image"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setSigFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SignatureManagement;
