import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Edit, Trash2, DollarSign } from "lucide-react";
import { getTests } from "@/lib/tests";

const PickupPointManager = () => {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pricingPointId, setPricingPointId] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [billingType, setBillingType] = useState("credit");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [discountPct, setDiscountPct] = useState(0);
  const [cloneFromId, setCloneFromId] = useState("");
  const [pricingSearch, setPricingSearch] = useState("");

  const { data: pickupPoints = [], isLoading } = useQuery({
    queryKey: ["pickup_points_all"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("*").order("name");
      return (data || []) as any[];
    },
  });

  const { data: tests = [] } = useQuery({ queryKey: ["tests"], queryFn: getTests });

  const { data: prices = [] } = useQuery({
    queryKey: ["pickup_point_prices", pricingPointId],
    queryFn: async () => {
      if (!pricingPointId) return [];
      const { data } = await supabase.from("pickup_point_prices").select("*").eq("pickup_point_id", pricingPointId);
      return (data || []) as any[];
    },
    enabled: !!pricingPointId,
  });

  const resetForm = () => {
    setName(""); setPhone(""); setAddress(""); setContactPerson("");
    setBillingType("credit"); setBillingCycle("monthly"); setDiscountPct(0);
    setEditingId(null);
  };

  const openEdit = (pp: any) => {
    setEditingId(pp.id);
    setName(pp.name); setPhone(pp.phone || ""); setAddress(pp.address || "");
    setContactPerson(pp.contact_person || ""); setBillingType(pp.billing_type);
    setBillingCycle(pp.billing_cycle); setDiscountPct(pp.default_discount_pct || 0);
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = {
        name: name.toUpperCase(), phone, address: address.toUpperCase(),
        contact_person: contactPerson.toUpperCase(), billing_type: billingType,
        billing_cycle: billingCycle, default_discount_pct: discountPct,
      };
      if (editingId) {
        const { error } = await supabase.from("pickup_points").update(payload as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pickup_points").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_points_all"] });
      qc.invalidateQueries({ queryKey: ["pickup_points"] });
      toast.success(editingId ? "Pickup point updated" : "Pickup point created");
      setFormOpen(false); resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pickup_points").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_points_all"] });
      toast.success("Deleted");
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("pickup_points").update({ status: newStatus } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pickup_points_all"] }),
  });

  // Pricing
  const savePrice = useMutation({
    mutationFn: async ({ testId, price }: { testId: string; price: number }) => {
      const { error } = await supabase.from("pickup_point_prices").upsert({
        pickup_point_id: pricingPointId, test_id: testId, custom_price: price,
      } as any, { onConflict: "pickup_point_id,test_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_point_prices", pricingPointId] });
      toast.success("Price saved");
    },
  });

  const deletePrice = useMutation({
    mutationFn: async (testId: string) => {
      const { error } = await supabase.from("pickup_point_prices").delete()
        .eq("pickup_point_id", pricingPointId).eq("test_id", testId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_point_prices", pricingPointId] });
    },
  });

  const pricingPoint = pickupPoints.find((p: any) => p.id === pricingPointId);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Pickup Points</h2>
        <Button onClick={() => { resetForm(); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Pickup Point</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Discount %</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : pickupPoints.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No pickup points</TableCell></TableRow>
            ) : pickupPoints.map((pp: any) => (
              <TableRow key={pp.id}>
                <TableCell className="font-medium">{pp.name}</TableCell>
                <TableCell>{pp.contact_person || "—"}</TableCell>
                <TableCell>{pp.phone || "—"}</TableCell>
                <TableCell>
                  <Badge variant={pp.billing_type === "credit" ? "secondary" : "default"}>{pp.billing_type}</Badge>
                  <span className="text-xs text-muted-foreground ml-1">({pp.billing_cycle})</span>
                </TableCell>
                <TableCell>{pp.default_discount_pct}%</TableCell>
                <TableCell>
                  <Badge variant={pp.status === "active" ? "default" : "secondary"} className="cursor-pointer"
                    onClick={() => toggleStatus.mutate({ id: pp.id, status: pp.status })}>
                    {pp.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(pp)}><Edit className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { setPricingPointId(pp.id); setPricingOpen(true); }}><DollarSign className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(pp.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={o => { if (!o) { setFormOpen(false); resetForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit" : "Add"} Pickup Point</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
            <div><Label>Contact Person</Label><Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div><Label>Address</Label><Input value={address} onChange={e => setAddress(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Billing Type</Label>
                <Select value={billingType} onValueChange={setBillingType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Credit</SelectItem>
                    <SelectItem value="debit">Debit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Billing Cycle</Label>
                <Select value={billingCycle} onValueChange={setBillingCycle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Default Discount %</Label><Input type="number" value={discountPct || ""} onChange={e => setDiscountPct(parseFloat(e.target.value) || 0)} /></div>
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pricing Dialog */}
      <Dialog open={pricingOpen} onOpenChange={o => { if (!o) setPricingOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Custom Pricing — {pricingPoint?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">Set custom prices for specific tests. Tests without custom prices use the default MRP.</p>
          <div className="space-y-2">
            {tests.map(t => {
              const existing = prices.find((p: any) => p.test_id === t.id);
              return (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{t.test_name}</span>
                  <span className="text-muted-foreground w-16 text-right">₹{t.price}</span>
                  <Input
                    type="number"
                    className="w-24 h-8 text-xs"
                    placeholder="Custom"
                    defaultValue={existing?.custom_price || ""}
                    onBlur={e => {
                      const val = parseFloat(e.target.value);
                      if (val > 0) savePrice.mutate({ testId: t.id, price: val });
                      else if (existing) deletePrice.mutate(t.id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PickupPointManager;
