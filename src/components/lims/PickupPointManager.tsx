import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Edit, Trash2, DollarSign, ListChecks } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { getTests } from "@/lib/tests";

type PriceRow = { test_id: string; custom_price: number };

// Reusable price editor — works against either pickup_point_prices or standard_price_list_items
function PriceEditor({
  ownerId,
  ownerType, // 'pickup' | 'standard'
  tests,
}: {
  ownerId: string;
  ownerType: "pickup" | "standard";
  tests: any[];
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showConfiguredOnly, setShowConfiguredOnly] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [hasInitView, setHasInitView] = useState(false);

  const table = ownerType === "pickup" ? "pickup_point_prices" : "standard_price_list_items";
  const ownerCol = ownerType === "pickup" ? "pickup_point_id" : "price_list_id";
  const queryKey = [table, ownerId];

  const { data: prices = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await supabase.from(table as any).select("test_id, custom_price").eq(ownerCol, ownerId);
      return ((data || []) as unknown) as PriceRow[];
    },
    enabled: !!ownerId,
  });

  // Default to "Configured only" when there's at least one configured price
  if (!hasInitView && prices.length > 0) {
    setShowConfiguredOnly(true);
    setHasInitView(true);
  }

  const saveMut = useMutation({
    mutationFn: async ({ testId, price }: { testId: string; price: number }) => {
      const { error } = await supabase.from(table as any).upsert(
        { [ownerCol]: ownerId, test_id: testId, custom_price: price } as any,
        { onConflict: `${ownerCol},test_id` },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Price saved");
    },
  });

  const delMut = useMutation({
    mutationFn: async (testId: string) => {
      const { error } = await supabase.from(table as any).delete().eq(ownerCol, ownerId).eq("test_id", testId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Price removed");
    },
  });

  const bulkDelMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from(table as any).delete().eq(ownerCol, ownerId).in("test_id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey });
      setSelectedTestIds(new Set());
      toast.success(`${count} custom price${count === 1 ? "" : "s"} removed`);
    },
  });

  const deleteAllMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from(table as any).delete().eq(ownerCol, ownerId);
      if (error) throw error;
      return prices.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey });
      setSelectedTestIds(new Set());
      toast.success(`All ${count} custom prices removed`);
    },
  });

  const pricesById = new Map(prices.map(p => [p.test_id, p]));
  const q = search.trim().toLowerCase();
  const searched = q
    ? tests.filter((t: any) => (t.test_name || "").toLowerCase().includes(q) || (t.test_code || "").toLowerCase().includes(q))
    : tests;
  const filtered = showConfiguredOnly
    ? searched.filter((t: any) => pricesById.has(t.id))
    : searched;

  const visibleConfiguredIds = filtered.filter((t: any) => pricesById.has(t.id)).map((t: any) => t.id);
  const allVisibleSelected = visibleConfiguredIds.length > 0 && visibleConfiguredIds.every(id => selectedTestIds.has(id));
  const someVisibleSelected = visibleConfiguredIds.some(id => selectedTestIds.has(id));

  const toggleAllVisible = () => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleConfiguredIds.forEach(id => next.delete(id));
      } else {
        visibleConfiguredIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRemoveSelected = () => {
    const ids = Array.from(selectedTestIds);
    if (ids.length === 0) return;
    if (window.confirm(`Remove ${ids.length} custom price${ids.length === 1 ? "" : "s"}? Tests will revert to base price.`)) {
      bulkDelMut.mutate(ids);
    }
  };

  const handleRemoveAll = () => {
    if (prices.length === 0) return;
    if (window.confirm(`Remove ALL ${prices.length} custom price${prices.length === 1 ? "" : "s"} for this ${ownerType === "pickup" ? "pickup point" : "price list"}? This cannot be undone.`)) {
      deleteAllMut.mutate();
    }
  };

  const handleRowDelete = (testId: string, testName: string) => {
    if (window.confirm(`Remove custom price for "${testName}"?`)) {
      delMut.mutate(testId);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 bg-background pb-2 z-10 flex items-center gap-2 flex-wrap">
        <Input placeholder="Search tests by name or code…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm flex-1 min-w-[200px]" />
        <div className="flex items-center gap-2 text-xs">
          <Label htmlFor={`cfg-only-${ownerId}`} className="text-xs cursor-pointer">Configured only</Label>
          <Switch id={`cfg-only-${ownerId}`} checked={showConfiguredOnly} onCheckedChange={setShowConfiguredOnly} />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} test{filtered.length === 1 ? "" : "s"} • {prices.length} configured</span>
      </div>

      {(prices.length > 0 || selectedTestIds.size > 0) && (
        <div className="flex items-center gap-2 px-2 py-2 mb-2 bg-muted/40 rounded border">
          <span className="text-xs font-medium">{selectedTestIds.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={selectedTestIds.size === 0 || bulkDelMut.isPending}
            onClick={handleRemoveSelected}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Remove selected
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            disabled={prices.length === 0 || deleteAllMut.isPending}
            onClick={handleRemoveAll}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Remove all configured ({prices.length})
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 px-1 py-1 border-b text-xs font-medium text-muted-foreground sticky bg-background z-10">
        <span className="w-8 flex justify-center">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
            onCheckedChange={toggleAllVisible}
            disabled={visibleConfiguredIds.length === 0}
          />
        </span>
        <span className="w-32">Test Code</span>
        <span className="flex-1">Test Name</span>
        <span className="w-28 text-right">Base Price</span>
        <span className="w-32 text-right">Custom Price</span>
        <span className="w-10" />
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {showConfiguredOnly && prices.length === 0
              ? "No tests configured yet. Switch to 'All tests' to add custom prices."
              : "No tests match"}
          </p>
        ) : (
          filtered.map((t: any) => {
            const existing = pricesById.get(t.id);
            const isConfigured = !!existing;
            return (
              <div key={t.id} className="flex items-center gap-2 text-sm py-1 border-b border-border/40">
                <span className="w-8 flex justify-center">
                  <Checkbox
                    checked={selectedTestIds.has(t.id)}
                    onCheckedChange={() => toggleOne(t.id)}
                    disabled={!isConfigured}
                  />
                </span>
                <span className="w-32 truncate text-xs text-muted-foreground">{t.test_code || "—"}</span>
                <span className="flex-1 truncate">{t.test_name}</span>
                <span className="text-muted-foreground w-28 text-right">₹{t.price}</span>
                <Input
                  type="number"
                  className="w-32 h-8 text-xs text-right"
                  placeholder="Custom"
                  defaultValue={existing?.custom_price || ""}
                  key={`${t.id}-${existing?.custom_price ?? ""}`}
                  onBlur={e => {
                    const val = parseFloat(e.target.value);
                    if (val > 0) saveMut.mutate({ testId: t.id, price: val });
                    else if (existing) delMut.mutate(t.id);
                  }}
                />
                <span className="w-10 flex justify-center">
                  {isConfigured && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleRowDelete(t.id, t.test_name)}
                      title="Remove custom price"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const PickupPointManager = () => {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pricingPointId, setPricingPointId] = useState("");

  // Pickup point form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [billingType, setBillingType] = useState("credit");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [discountPct, setDiscountPct] = useState(0);
  const [allowAllTests, setAllowAllTests] = useState(false);
  const [reportFooterNote, setReportFooterNote] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");
  const [applyStdListId, setApplyStdListId] = useState("");

  // Standard list state
  const [stdListOpen, setStdListOpen] = useState(false);
  const [stdListEditId, setStdListEditId] = useState<string | null>(null);
  const [stdName, setStdName] = useState("");
  const [stdDescription, setStdDescription] = useState("");
  const [stdPricesOpenId, setStdPricesOpenId] = useState<string | null>(null);

  const { data: pickupPoints = [], isLoading } = useQuery({
    queryKey: ["pickup_points_all"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("*").order("name");
      return (data || []) as any[];
    },
  });

  const { data: tests = [] } = useQuery({ queryKey: ["tests"], queryFn: getTests });

  const { data: standardLists = [] } = useQuery({
    queryKey: ["standard_price_lists"],
    queryFn: async () => {
      const { data } = await supabase.from("standard_price_lists" as any).select("*").order("name");
      return (data || []) as any[];
    },
  });

  const { data: stdListCounts = {} } = useQuery({
    queryKey: ["standard_price_list_counts"],
    queryFn: async () => {
      const { data } = await supabase.from("standard_price_list_items" as any).select("price_list_id");
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => { counts[r.price_list_id] = (counts[r.price_list_id] || 0) + 1; });
      return counts;
    },
  });

  const resetForm = () => {
    setName(""); setPhone(""); setAddress(""); setContactPerson("");
    setBillingType("credit"); setBillingCycle("monthly"); setDiscountPct(0);
    setAllowAllTests(false);
    setEditingId(null); setCloneFromId(""); setApplyStdListId("");
  };

  const openEdit = (pp: any) => {
    setEditingId(pp.id);
    setName(pp.name); setPhone(pp.phone || ""); setAddress(pp.address || "");
    setContactPerson(pp.contact_person || ""); setBillingType(pp.billing_type);
    setBillingCycle(pp.billing_cycle); setDiscountPct(pp.default_discount_pct || 0);
    setAllowAllTests(!!pp.allow_all_tests);
    setApplyStdListId("");
    setFormOpen(true);
  };

  // Helper: apply a standard list's items to a pickup point (upsert)
  const applyStdListToPickup = async (pickupId: string, stdListId: string) => {
    const { data: items } = await supabase.from("standard_price_list_items" as any)
      .select("test_id, custom_price").eq("price_list_id", stdListId);
    if (!items || items.length === 0) return 0;
    const rows = (items as any[]).map(i => ({
      pickup_point_id: pickupId, test_id: i.test_id, custom_price: i.custom_price,
    }));
    const { error } = await supabase.from("pickup_point_prices").upsert(rows as any, { onConflict: "pickup_point_id,test_id" });
    if (error) throw error;
    return rows.length;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      const payload = {
        name: name.toUpperCase(), phone, address: address.toUpperCase(),
        contact_person: contactPerson.toUpperCase(), billing_type: billingType,
        billing_cycle: billingCycle, default_discount_pct: discountPct,
        allow_all_tests: allowAllTests,
      };
      let pickupId = editingId;
      let appliedCount = 0;
      let appliedListName = "";

      if (editingId) {
        const { error } = await supabase.from("pickup_points").update(payload as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from("pickup_points").insert(payload as any).select("id").single();
        if (error) throw error;
        pickupId = inserted!.id;
        // Clone from another pickup point (only when no standard list selected)
        if (cloneFromId && !applyStdListId && pickupId) {
          const { data: srcPrices } = await supabase.from("pickup_point_prices")
            .select("test_id, custom_price").eq("pickup_point_id", cloneFromId);
          if (srcPrices && srcPrices.length > 0) {
            const rows = srcPrices.map((p: any) => ({
              pickup_point_id: pickupId, test_id: p.test_id, custom_price: p.custom_price,
            }));
            const { error: insErr } = await supabase.from("pickup_point_prices").insert(rows as any);
            if (insErr) throw insErr;
            appliedCount = rows.length;
            appliedListName = "cloned source";
          }
        }
      }

      // Apply standard list (Add or Edit; takes precedence over clone)
      if (applyStdListId && pickupId) {
        appliedCount = await applyStdListToPickup(pickupId, applyStdListId);
        appliedListName = standardLists.find((l: any) => l.id === applyStdListId)?.name || "list";
      }
      return { appliedCount, appliedListName };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["pickup_points_all"] });
      qc.invalidateQueries({ queryKey: ["pickup_points"] });
      const base = editingId ? "Pickup point updated" : "Pickup point created";
      const msg = result?.appliedCount
        ? `${base} — ${result.appliedCount} prices applied from ${result.appliedListName}`
        : base;
      toast.success(msg);
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

  // Standard list mutations
  const saveStdList = useMutation({
    mutationFn: async () => {
      if (!stdName.trim()) throw new Error("Name is required");
      const payload = { name: stdName.trim(), description: stdDescription.trim() || null };
      if (stdListEditId) {
        const { error } = await supabase.from("standard_price_lists" as any).update(payload as any).eq("id", stdListEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("standard_price_lists" as any).insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["standard_price_lists"] });
      toast.success("Saved");
      setStdListOpen(false); setStdListEditId(null); setStdName(""); setStdDescription("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delStdList = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("standard_price_lists" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["standard_price_lists"] });
      qc.invalidateQueries({ queryKey: ["standard_price_list_counts"] });
      toast.success("Deleted");
    },
  });

  // Apply std list inside the pricing dialog (re-sync)
  const [applyInPricing, setApplyInPricing] = useState("");
  const applyInPricingMut = useMutation({
    mutationFn: async () => {
      if (!applyInPricing || !pricingPointId) throw new Error("Select a list");
      const count = await applyStdListToPickup(pricingPointId, applyInPricing);
      return { count, name: standardLists.find((l: any) => l.id === applyInPricing)?.name };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["pickup_point_prices", pricingPointId] });
      toast.success(`${r.count} prices applied from ${r.name}`);
      setApplyInPricing("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pricingPoint = pickupPoints.find((p: any) => p.id === pricingPointId);
  const stdPricesPoint = standardLists.find((l: any) => l.id === stdPricesOpenId);

  return (
    <div className="space-y-6">
      {/* Standard Price Lists */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" />Standard Price Lists</CardTitle>
          <Button size="sm" onClick={() => { setStdListEditId(null); setStdName(""); setStdDescription(""); setStdListOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />Add Standard List
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">Define reusable price lists once, then apply them to any pickup point.</p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead># Tests</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standardLists.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground text-sm">No standard price lists yet</TableCell></TableRow>
                ) : standardLists.map((sl: any) => (
                  <TableRow key={sl.id}>
                    <TableCell className="font-medium">{sl.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{sl.description || "—"}</TableCell>
                    <TableCell>{stdListCounts[sl.id] || 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setStdPricesOpenId(sl.id)} title="Edit prices"><DollarSign className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { setStdListEditId(sl.id); setStdName(sl.name); setStdDescription(sl.description || ""); setStdListOpen(true); }}><Edit className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${sl.name}"? Pickup points already using it keep their prices.`)) delStdList.mutate(sl.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pickup Points */}
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
              <TableHead>Tests</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : pickupPoints.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No pickup points</TableCell></TableRow>
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
                  <Badge variant={pp.allow_all_tests ? "secondary" : "outline"}>
                    {pp.allow_all_tests ? "All tests" : "Restricted"}
                  </Badge>
                </TableCell>
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

      {/* Add/Edit Pickup Point Dialog */}
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

            <div className="flex items-start justify-between gap-3 rounded-md border p-3 bg-muted/30">
              <div className="flex-1">
                <Label className="text-sm">Allow all tests during registration</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When OFF, only tests with a configured custom price appear during registration for this pickup point.
                </p>
              </div>
              <Switch checked={allowAllTests} onCheckedChange={setAllowAllTests} />
            </div>

            <div>
              <Label>Apply Standard Price List (optional)</Label>
              <Select value={applyStdListId || "__none__"} onValueChange={v => setApplyStdListId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {standardLists.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({stdListCounts[l.id] || 0} tests)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {applyStdListId && <p className="text-xs text-muted-foreground mt-1">Existing custom prices for matching tests will be overwritten.</p>}
            </div>

            {!editingId && (
              <div>
                <Label>Clone Pricing From (optional)</Label>
                <Select value={cloneFromId || "__none__"} onValueChange={v => setCloneFromId(v === "__none__" ? "" : v)} disabled={!!applyStdListId}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {pickupPoints.filter((p: any) => p.status === "active").map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {applyStdListId && <p className="text-xs text-muted-foreground mt-1">Disabled — standard list takes precedence.</p>}
              </div>
            )}
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pickup Point Pricing Dialog */}
      <Dialog open={pricingOpen} onOpenChange={o => { if (!o) { setPricingOpen(false); setApplyInPricing(""); } }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Custom Pricing — {pricingPoint?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">Set custom prices for specific tests. Tests without custom prices use the default MRP.</p>

          {standardLists.length > 0 && (
            <div className="flex gap-2 mb-3 p-2 rounded-md bg-muted/40 border">
              <Select value={applyInPricing || "__none__"} onValueChange={v => setApplyInPricing(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Apply Standard List…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a list…</SelectItem>
                  {standardLists.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({stdListCounts[l.id] || 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!applyInPricing || applyInPricingMut.isPending} onClick={() => applyInPricingMut.mutate()}>
                Apply
              </Button>
            </div>
          )}

          {pricingPointId && <PriceEditor ownerId={pricingPointId} ownerType="pickup" tests={tests} />}
        </DialogContent>
      </Dialog>

      {/* Standard List Add/Edit Dialog */}
      <Dialog open={stdListOpen} onOpenChange={o => { if (!o) { setStdListOpen(false); setStdListEditId(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{stdListEditId ? "Edit" : "Add"} Standard Price List</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={stdName} onChange={e => setStdName(e.target.value)} placeholder="e.g. Standard Hospital Rates" /></div>
            <div><Label>Description</Label><Textarea value={stdDescription} onChange={e => setStdDescription(e.target.value)} rows={2} /></div>
            <Button className="w-full" onClick={() => saveStdList.mutate()} disabled={saveStdList.isPending}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Standard List Pricing Dialog */}
      <Dialog open={!!stdPricesOpenId} onOpenChange={o => { if (!o) setStdPricesOpenId(null); }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Standard List Prices — {stdPricesPoint?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">Edit the master prices for this list. Apply to pickup points from the pickup point dialog.</p>
          {stdPricesOpenId && <PriceEditor ownerId={stdPricesOpenId} ownerType="standard" tests={tests} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PickupPointManager;
