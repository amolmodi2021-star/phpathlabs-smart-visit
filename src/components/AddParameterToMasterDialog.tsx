import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parameterName: string;
  unit?: string;
  department?: string;
  profileName?: string;
  testName?: string;
  onAdded: (parameterId: string) => void;
}

export default function AddParameterToMasterDialog({
  open, onOpenChange, parameterName, unit, department, profileName, testName, onAdded
}: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [paramName, setParamName] = useState(parameterName);
  const [paramUnit, setParamUnit] = useState(unit || "");
  const [paramTestName, setParamTestName] = useState(testName || "");
  const [storeAnalytics, setStoreAnalytics] = useState(false);

  useEffect(() => {
    if (open) {
      setParamName(parameterName);
      setParamUnit(unit || "");
      setParamTestName(testName || "");
      setSelectedDeptId("");
      setSelectedProfileId("");
      loadMasterData();
    }
  }, [open, parameterName]);

  const loadMasterData = async () => {
    const [{ data: depts }, { data: profs }] = await Promise.all([
      supabase.from("report_departments").select("*").order("display_order"),
      supabase.from("report_profiles").select("*").order("display_order"),
    ]);
    setDepartments(depts || []);
    setProfiles(profs || []);

    // Auto-match department
    if (department && depts?.length) {
      const match = depts.find((d: any) => d.department_name.toLowerCase() === department.toLowerCase());
      if (match) {
        setSelectedDeptId(match.id);
        // Auto-match profile under that department
        if (profileName && profs?.length) {
          const profMatch = profs.find((p: any) => p.department_id === match.id && p.profile_name.toLowerCase() === profileName.toLowerCase());
          if (profMatch) setSelectedProfileId(profMatch.id);
        }
      }
    }
  };

  const filteredProfiles = selectedDeptId
    ? profiles.filter((p) => p.department_id === selectedDeptId)
    : profiles;

  const handleSave = async () => {
    if (!paramName.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("report_test_parameters").insert({
        parameter_name: paramName.trim(),
        unit: paramUnit || null,
        test_name: paramTestName || null,
        department_id: selectedDeptId || null,
        profile_id: selectedProfileId || null,
        store_for_analytics: storeAnalytics,
      }).select("id").single();

      if (error) throw error;
      toast({ title: "Parameter added to master data!" });
      onAdded(data.id);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error adding parameter", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Parameter to Master Data</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Parameter Name</Label>
            <Input value={paramName} onChange={(e) => setParamName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Test Name</Label>
              <Input value={paramTestName} onChange={(e) => setParamTestName(e.target.value)} />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={paramUnit} onChange={(e) => setParamUnit(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Range Low</Label>
              <Input value={rangeLow} onChange={(e) => setRangeLow(e.target.value)} type="number" />
            </div>
            <div>
              <Label>Range High</Label>
              <Input value={rangeHigh} onChange={(e) => setRangeHigh(e.target.value)} type="number" />
            </div>
            <div>
              <Label>Range Text</Label>
              <Input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="e.g. 4.0-11.0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Department</Label>
              <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.department_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Profile</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {filteredProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.profile_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={storeAnalytics} onCheckedChange={(v) => setStoreAnalytics(!!v)} id="store-analytics" />
            <Label htmlFor="store-analytics" className="cursor-pointer">Store for analytics</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !paramName.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Parameter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
