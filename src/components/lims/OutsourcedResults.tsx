import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Search, ChevronDown, ChevronUp, Save, Loader2, Image, Keyboard,
  Clipboard, Trash2, ExternalLink, Package, Send, Clock, CheckCircle2, Pencil, Plus, FileText, ArrowLeftRight
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import SnipOnLetterhead from "./SnipOnLetterhead";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface OutsourcedTest {
  testId: string;
  testName: string;
  outsourcedCaption: string;
  isTransferredInhouse: boolean; // true = originally inhouse, transferred to outsourced
  outsourcedParameterIds?: string[]; // if set, only these params are outsourced (parameter-level)
  isParameterLevel: boolean; // true = only specific params outsourced, not whole test
}

interface OutsourcedPatient {
  registration: any;
  outsourcedTests: OutsourcedTest[];
}

const OutsourcedResults = ({ externalSearch }: { externalSearch?: string }) => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const { data: outsourceLabs = [] } = useMasterLookup("outsource_lab");

  // Selection & mark-as-sent state
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [showLabDialog, setShowLabDialog] = useState(false);
  const [labName, setLabName] = useState("");
  const [markingSent, setMarkingSent] = useState(false);

  // Edit lab name state
  const [editLabKey, setEditLabKey] = useState<string | null>(null);
  const [editLabName, setEditLabName] = useState("");
  const [savingEditLab, setSavingEditLab] = useState(false);

  // Return to inhouse state
  const [returningKey, setReturningKey] = useState<string | null>(null);

  // Return entire test to inhouse
  const returnToInhouse = async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setReturningKey(key);
    try {
      await supabase.from("outsourced_test_snips").delete().eq("registration_id", regId).eq("test_id", testId);
      toast.success(`${testName} returned to Inhouse`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_accepted_regs"] });
      qc.invalidateQueries({ queryKey: ["results_accepted_regs"] });
    } catch (err: any) {
      toast.error(err.message || "Return failed");
    } finally {
      setReturningKey(null);
    }
  };

  // Return individual parameter to inhouse
  const returnParamToInhouse = async (regId: string, testId: string, paramId: string, paramName: string) => {
    const key = `${regId}||${paramId}`;
    setReturningKey(key);
    try {
      const snip = existingSnips.find((s: any) => s.registration_id === regId && s.test_id === testId);
      const currentIds: string[] = Array.isArray(snip?.outsourced_parameter_ids) ? snip.outsourced_parameter_ids : [];
      const newIds = currentIds.filter(id => id !== paramId);
      if (newIds.length === 0) {
        // No more outsourced params, delete the snip record
        await supabase.from("outsourced_test_snips").delete().eq("registration_id", regId).eq("test_id", testId);
      } else {
        await supabase.from("outsourced_test_snips").update({
          outsourced_parameter_ids: newIds,
        } as any).eq("registration_id", regId).eq("test_id", testId);
      }
      toast.success(`${paramName} returned to Inhouse`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Return failed");
    } finally {
      setReturningKey(null);
    }
  };

  // Sync external search to debounced
  useEffect(() => {
    if (externalSearch !== undefined) {
      setDebouncedSearch(externalSearch);
    }
  }, [externalSearch]);

  // Debounce search (internal fallback)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(val), 400);
  }, []);

  // Fetch accepted registrations
  const { data: acceptedRegs = [], isLoading } = useQuery({
    queryKey: ["outsourced_accepted_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .eq("status", "sample_accepted")
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch tests master
  const { data: testsMap = {} } = useQuery({
    queryKey: ["outsourced_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, is_outsourced, outsourced_caption");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // Fetch existing snips
  const regIds = acceptedRegs.map((r: any) => r.id);
  const { data: existingSnips = [] } = useQuery({
    queryKey: ["outsourced_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outsourced_test_snips")
        .select("*")
        .in("registration_id", regIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch existing manual results
  const { data: existingResults = [] } = useQuery({
    queryKey: ["outsourced_manual_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_results")
        .select("*")
        .in("registration_id", regIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch test_parameters
  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["outsourced_test_params"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text)")
        .order("display_order");
      const map: Record<string, any[]> = {};
      (data || []).forEach((tp: any) => {
        if (!tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = [];
        map[tp.test_id].push(tp);
      });
      return map;
    },
  });

  // Fetch parameter_normal_ranges for age/gender-specific reference ranges
  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["outsourced_normal_ranges"],
    queryFn: async () => {
      const { data } = await supabase
        .from("parameter_normal_ranges")
        .select("*")
        .order("age_min");
      const map: Record<string, any[]> = {};
      (data || []).forEach((r: any) => {
        if (!map[r.parameter_id]) map[r.parameter_id] = [];
        map[r.parameter_id].push(r);
      });
      return map;
    },
  });

  // Helper: resolve best normal range for a parameter given patient demographics
  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null };
    let patientAge: number | null = null;
    if (reg.dob) {
      const birth = new Date(reg.dob);
      const now = new Date();
      patientAge = Math.floor((now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    const patientGender = (reg.gender || "").toLowerCase().charAt(0);
    let candidates = ranges.filter((r: any) => {
      const g = (r.gender || "all").toLowerCase();
      if (g === "all") return true;
      if (g === "male" && patientGender === "m") return true;
      if (g === "female" && patientGender === "f") return true;
      return false;
    });
    if (patientAge != null) {
      const ageMatched = candidates.filter((r: any) => {
        if (r.age_min == null && r.age_max == null) return true;
        if (r.age_min != null && patientAge! < r.age_min) return false;
        if (r.age_max != null && patientAge! > r.age_max) return false;
        return true;
      });
      if (ageMatched.length > 0) candidates = ageMatched;
    }
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return { text, low: best.normal_range_low as number | null, high: best.normal_range_high as number | null };
  }, [normalRangesMap]);

  // Build outsourced patient entries (includes naturally outsourced + transferred inhouse tests + parameter-level)
  const patientEntries: OutsourcedPatient[] = useMemo(() => {
    // Build maps from snips
    const transferredKeys = new Set<string>();
    const paramLevelMap: Record<string, string[]> = {};
    existingSnips.forEach((s: any) => {
      const testInfo = testsMap[s.test_id];
      const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
      if (paramIds.length > 0) {
        // Parameter-level outsource
        paramLevelMap[`${s.registration_id}||${s.test_id}`] = paramIds;
      } else if (!testInfo?.is_outsourced) {
        transferredKeys.add(`${s.registration_id}||${s.test_id}`);
      }
    });

    return acceptedRegs.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const outsourcedTests: OutsourcedTest[] = [];
      for (const t of tests) {
        if (cancelledIds.has(t.test_id)) continue;
        const testInfo = testsMap[t.test_id];
        const testKey = `${reg.id}||${t.test_id}`;
        const isTransferred = transferredKeys.has(testKey);
        const paramIds = paramLevelMap[testKey];

        if (testInfo?.is_outsourced) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "",
            outsourcedCaption: testInfo.outsourced_caption || "Outsourced Lab",
            isTransferredInhouse: false,
            isParameterLevel: false,
          });
        } else if (isTransferred) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo?.test_name || "",
            outsourcedCaption: "Transferred from Inhouse",
            isTransferredInhouse: true,
            isParameterLevel: false,
          });
        } else if (paramIds && paramIds.length > 0) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo?.test_name || "",
            outsourcedCaption: `${paramIds.length} parameter(s) outsourced`,
            isTransferredInhouse: true,
            isParameterLevel: true,
            outsourcedParameterIds: paramIds,
          });
        }
      }
      return { registration: reg, outsourcedTests };
    }).filter(e => e.outsourcedTests.length > 0);
  }, [acceptedRegs, testsMap, existingSnips]);

  // Get snip record
  const getSnip = (regId: string, testId: string) => {
    return existingSnips.find((s: any) => s.registration_id === regId && s.test_id === testId);
  };

  // Get all image URLs for a snip (multi-page support)
  const getSnipImageUrls = (regId: string, testId: string): string[] => {
    const snip = getSnip(regId, testId);
    if (!snip) return [];
    const urls: string[] = [];
    // Check new jsonb array first
    if (snip.snip_image_urls && Array.isArray(snip.snip_image_urls) && snip.snip_image_urls.length > 0) {
      urls.push(...(snip.snip_image_urls as string[]));
    }
    // Fallback to legacy single URL if urls array is empty
    if (urls.length === 0 && snip.snip_image_url) {
      urls.push(snip.snip_image_url);
    }
    return urls;
  };

  const hasManualResults = (regId: string, testId: string) => {
    return existingResults.some((r: any) => r.registration_id === regId && r.test_id === testId && r.result_value);
  };

  // Check if a test has all results filled (no pending params)
  const hasAllResultsFilled = (regId: string, testId: string, outsourcedParamIds?: string[]) => {
    const params = testParamsMap[testId] || [];
    const relevantParams = params.filter((tp: any) => {
      if (tp.is_subheader) return false;
      const p = tp.report_test_parameters;
      if (!p) return false;
      if (outsourcedParamIds && outsourcedParamIds.length > 0 && !outsourcedParamIds.includes(p.id)) return false;
      return true;
    });
    if (relevantParams.length === 0) return false;
    return relevantParams.every((tp: any) => {
      const p = tp.report_test_parameters;
      const existing = existingResults.find((r: any) => r.registration_id === regId && r.parameter_id === p.id);
      return existing?.result_value && existing.result_value.trim() !== "";
    });
  };

  // Get outsource status from snip record
  const getOutsourceStatus = (regId: string, testId: string) => {
    const snip = getSnip(regId, testId);
    if (!snip) return "pending"; // not yet sent
    return (snip as any).outsource_status || "pending";
  };

  // Get test display status
  const getTestStatus = (regId: string, testId: string) => {
    const outsourceStatus = getOutsourceStatus(regId, testId);
    if (outsourceStatus === "pending") return "not_sent";
    if (outsourceStatus === "results_saved" || outsourceStatus === "results_entered") {
      // Verify actual data exists — if snip was removed, status may be stale
      const snip = getSnip(regId, testId);
      if (snip?.result_mode === "snip") {
        const imageUrls = getSnipImageUrls(regId, testId);
        if (imageUrls.length === 0) return "awaiting_results";
      }
      if (snip?.result_mode === "manual" && !hasManualResults(regId, testId)) {
        // Status says results_saved but no manual results exist
        return "awaiting_results";
      }
      return "results_saved";
    }

    const snip = getSnip(regId, testId);
    if (snip?.result_mode === "manual" && hasManualResults(regId, testId)) return "results_saved";

    return "awaiting_results"; // sent but still under review until user saves
  };

  // Toggle test selection
  const toggleTestSelection = (regId: string, testId: string) => {
    const key = `${regId}||${testId}`;
    setSelectedTests(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Select all pending tests for a patient
  const toggleAllForPatient = (entry: OutsourcedPatient, checked: boolean) => {
    setSelectedTests(prev => {
      const next = new Set(prev);
      for (const t of entry.outsourcedTests) {
        const key = `${entry.registration.id}||${t.testId}`;
        const status = getTestStatus(entry.registration.id, t.testId);
        if (status === "not_sent") {
          if (checked) next.add(key); else next.delete(key);
        }
      }
      return next;
    });
  };

  // Mark selected tests as sent to outsourced lab
  const markAsSent = async () => {
    if (!labName.trim()) {
      toast.error("Please enter the outsourced lab name");
      return;
    }
    setMarkingSent(true);
    try {
      const entries = Array.from(selectedTests).map(k => {
        const [regId, testId] = k.split("||");
        return { regId, testId };
      });

      for (const { regId, testId } of entries) {
        await supabase
          .from("outsourced_test_snips")
          .upsert({
            registration_id: regId,
            test_id: testId,
            outsourced_lab_name: labName.trim(),
            outsource_status: "sent",
            result_mode: "manual",
            sent_at: new Date().toISOString(),
          } as any, { onConflict: "registration_id,test_id" });
      }

      toast.success(`${entries.length} test(s) marked as sent to "${labName.trim()}"`);
      setSelectedTests(new Set());
      setShowLabDialog(false);
      setLabName("");
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to mark tests");
    } finally {
      setMarkingSent(false);
    }
  };

  // Handle paste from clipboard
  const handlePaste = useCallback(async (regId: string, testId: string, event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const key = `${regId}||${testId}`;
        setUploadingKey(key);
        try {
          const fileName = `${regId}_${testId}_${Date.now()}.png`;
          const { error: uploadError } = await supabase.storage
            .from("outsourced-snips")
            .upload(fileName, file, { contentType: "image/png", upsert: true });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from("outsourced-snips").getPublicUrl(fileName);
          // Append to existing URLs array
          const existingUrls = getSnipImageUrls(regId, testId);
          const newUrls = [...existingUrls, urlData.publicUrl];
          await supabase.from("outsourced_test_snips").upsert({
            registration_id: regId,
            test_id: testId,
            snip_image_url: newUrls[0],
            snip_image_urls: newUrls,
            result_mode: "snip",
            outsource_status: "sent",
          } as any, { onConflict: "registration_id,test_id" });
          toast.success(`Page ${newUrls.length} added successfully`);
          qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
        } catch (err: any) {
          toast.error(err.message || "Failed to upload snip");
        } finally {
          setUploadingKey(null);
        }
        return;
      }
    }
  }, [qc, existingSnips]);

  // Handle file upload
  const handleFileUpload = useCallback(async (regId: string, testId: string, file: File) => {
    const key = `${regId}||${testId}`;
    setUploadingKey(key);
    try {
      const fileName = `${regId}_${testId}_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from("outsourced-snips")
        .upload(fileName, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("outsourced-snips").getPublicUrl(fileName);
      // Append to existing URLs array
      const existingUrls = getSnipImageUrls(regId, testId);
      const newUrls = [...existingUrls, urlData.publicUrl];
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        snip_image_url: newUrls[0],
        snip_image_urls: newUrls,
        result_mode: "snip",
        outsource_status: "sent",
      } as any, { onConflict: "registration_id,test_id" });
      toast.success(`Page ${newUrls.length} added successfully`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      setUploadingKey(null);
    }
  }, [qc, existingSnips]);

  // Delete a specific snip page
  const deleteSnipPage = useCallback(async (regId: string, testId: string, pageIndex: number) => {
    try {
      const currentUrls = getSnipImageUrls(regId, testId);
      const newUrls = currentUrls.filter((_, i) => i !== pageIndex);
      if (newUrls.length === 0) {
        // No more images — reset back to awaiting results
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: null,
          snip_image_urls: [],
          result_mode: "manual",
          outsource_status: "sent",
        } as any).eq("registration_id", regId).eq("test_id", testId);
        toast.success("All pages removed — test moved back to awaiting results");
      } else {
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: newUrls[0],
          snip_image_urls: newUrls,
        } as any).eq("registration_id", regId).eq("test_id", testId);
        toast.success(`Page ${pageIndex + 1} removed`);
      }
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error("Failed to delete page");
    }
  }, [qc, existingSnips]);

  // Set manual mode
  const setManualMode = useCallback(async (regId: string, testId: string) => {
    try {
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        result_mode: "manual",
        snip_image_url: null,
        snip_image_urls: [],
      } as any, { onConflict: "registration_id,test_id" });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error("Failed to set manual mode");
    }
  }, [qc]);

  // Save manual results
  const saveManualResults = useCallback(async (regId: string, testId: string, testName: string, outsourcedParamIds?: string[], reg?: any) => {
    const key = `${regId}||${testId}`;
    setSavingKey(key);
    try {
      const params = testParamsMap[testId] || [];
      const upserts: any[] = [];
      for (const tp of params) {
        if (tp.is_subheader) continue;
        const p = tp.report_test_parameters;
        if (!p) continue;
        // For parameter-level outsource, only save outsourced parameters
        if (outsourcedParamIds && outsourcedParamIds.length > 0 && !outsourcedParamIds.includes(p.id)) continue;
        const valKey = `${regId}||${p.id}`;
        const value = editedValues[valKey] || "";
        if (!value) continue;
        const resolved = reg ? resolveNormalRange(p.id, reg) : { text: "", low: null, high: null };
        const rangeLow = resolved.low ?? p.normal_range_low;
        const rangeHigh = resolved.high ?? p.normal_range_high;
        const rangeText = resolved.text || p.normal_range_text || (rangeLow != null && rangeHigh != null ? `${rangeLow} - ${rangeHigh}` : "");
        const num = parseFloat(value);
        let flag = "";
        if (!isNaN(num)) {
          if (rangeLow != null && num < rangeLow) flag = "L";
          else if (rangeHigh != null && num > rangeHigh) flag = "H";
          else flag = "N";
        }
        upserts.push({
          registration_id: regId, test_id: testId, parameter_id: p.id,
          param_code: p.param_code, parameter_name: p.parameter_name,
          result_value: value, unit: p.unit,
          reference_range: rangeText,
          normal_range_low: rangeLow, normal_range_high: rangeHigh,
          flag: flag || null, status: "pending", is_calculated: false, is_from_interface: false,
        });
      }
      if (upserts.length > 0) {
        if (outsourcedParamIds && outsourcedParamIds.length > 0) {
          // Parameter-level: only delete outsourced param results, not all
          for (const paramId of outsourcedParamIds) {
            await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId).eq("parameter_id", paramId);
          }
        } else {
          await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId);
        }
        const { error } = await supabase.from("patient_results").insert(upserts as any);
        if (error) throw error;
      }
      // Update snip record status
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId, test_id: testId,
        result_mode: "manual", outsource_status: "results_saved",
      } as any, { onConflict: "registration_id,test_id" });

      toast.success(`Results saved for ${testName}`);
      setEditedValues(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { if (k.startsWith(`${regId}||`)) delete next[k]; });
        return next;
      });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
      qc.invalidateQueries({ queryKey: ["verification_results"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save results");
    } finally {
      setSavingKey(null);
    }
  }, [editedValues, testParamsMap, qc, resolveNormalRange]);

  // Save snip results and move to verification
  const saveSnipResults = useCallback(async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setSavingKey(key);
    try {
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId, test_id: testId,
        result_mode: "snip", outsource_status: "results_saved",
      } as any, { onConflict: "registration_id,test_id" });

      toast.success(`Snip saved for ${testName}`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["verification_results"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSavingKey(null);
    }
  }, [qc]);

  const saveEditLabName = async () => {
    if (!editLabKey || !editLabName.trim()) return;
    setSavingEditLab(true);
    try {
      const [regId, testId] = editLabKey.split("||");
      await supabase.from("outsourced_test_snips").update({
        outsourced_lab_name: editLabName.trim(),
      } as any).eq("registration_id", regId).eq("test_id", testId);
      toast.success("Outsourced lab name updated");
      setEditLabKey(null);
      setEditLabName("");
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSavingEditLab(false);
    }
  };

  // Format sent_at date/time
  const formatSentAt = (sentAt: string | null) => {
    if (!sentAt) return null;
    try {
      const d = new Date(sentAt);
      return format(d, "dd-MM-yyyy hh:mm a");
    } catch { return null; }
  };

  // Status badge renderer
  const renderStatusBadge = (regId: string, testId: string) => {
    const status = getTestStatus(regId, testId);
    const snip = getSnip(regId, testId);
    const labNameVal = (snip as any)?.outsourced_lab_name;
    const sentAt = formatSentAt((snip as any)?.sent_at);

    switch (status) {
      case "not_sent":
        return <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">Not Sent</Badge>;
      case "awaiting_results":
        return (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge className="text-xs bg-amber-500 text-white gap-1">
              <Clock className="h-3 w-3" /> Awaiting Results
            </Badge>
            {labNameVal && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                {labNameVal}
                <button onClick={(e) => { e.stopPropagation(); setEditLabKey(`${regId}||${testId}`); setEditLabName(labNameVal); }} className="hover:text-primary">
                  <Pencil className="h-3 w-3" />
                </button>
              </span>
            )}
            {sentAt && <span className="text-[10px] text-muted-foreground">{sentAt}</span>}
          </div>
        );
      case "results_saved":
        return (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge className="text-xs bg-green-600 text-white gap-1">
              <CheckCircle2 className="h-3 w-3" /> Results Saved
            </Badge>
            {labNameVal && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                {labNameVal}
                <button onClick={(e) => { e.stopPropagation(); setEditLabKey(`${regId}||${testId}`); setEditLabName(labNameVal); }} className="hover:text-primary">
                  <Pencil className="h-3 w-3" />
                </button>
              </span>
            )}
            {sentAt && <span className="text-[10px] text-muted-foreground">{sentAt}</span>}
          </div>
        );
      default:
        return null;
    }
  };

  // Count stats
  const stats = useMemo(() => {
    let notSent = 0, awaiting = 0, total = 0;
    let resultsSaved = 0;
    for (const e of patientEntries) {
      for (const t of e.outsourcedTests) {
        const s = getTestStatus(e.registration.id, t.testId);
        // Skip tests that have all results filled
        if (s === "results_saved") {
          const snip = getSnip(e.registration.id, t.testId);
          if (snip?.result_mode === "snip") {
            const testResults = existingResults.filter((r: any) => r.registration_id === e.registration.id && r.test_id === t.testId);
            if (testResults.length > 0 && testResults.every((r: any) => r.status === "verified")) continue;
          } else if (hasAllResultsFilled(e.registration.id, t.testId, t.outsourcedParameterIds)) continue;
        }
        total++;
        if (s === "not_sent") notSent++;
        else if (s === "awaiting_results") awaiting++;
        else if (s === "results_saved") resultsSaved++;
      }
    }
    return { notSent, awaiting, resultsSaved, total };
  }, [patientEntries, existingSnips, existingResults, testParamsMap]);

  // Render test card
  const renderTestCard = (entry: OutsourcedPatient, test: OutsourcedTest) => {
    const regId = entry.registration.id;
    const testKey = `${regId}||${test.testId}`;
    const isExpanded = expandedTest === testKey;
    const snip = getSnip(regId, test.testId);
    const status = getTestStatus(regId, test.testId);
    const params = testParamsMap[test.testId] || [];
    const hasParams = params.some((tp: any) => !tp.is_subheader && tp.report_test_parameters);
    const isUploading = uploadingKey === testKey;
    const isSaving = savingKey === testKey;
    const currentMode = hasParams ? (snip?.result_mode || "manual") : "snip";
    const isSelected = selectedTests.has(testKey);
    const canSelect = status === "not_sent";
    const canEnterResults = status === "awaiting_results";

    return (
      <div key={testKey} className="border rounded-lg overflow-hidden">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => {
            if (canEnterResults || status === "results_saved") {
              setExpandedTest(isExpanded ? null : testKey);
            }
          }}
        >
          {/* Checkbox for not-sent tests */}
          {canSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleTestSelection(regId, test.testId)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            />
          )}
          {(canEnterResults || status === "results_saved") && (
            isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <div className="flex-1">
            <span className="font-medium text-sm">{test.testName}</span>
            <span className="text-xs text-muted-foreground ml-2">({test.outsourcedCaption})</span>
            {test.isParameterLevel && (
              <Badge variant="outline" className="ml-2 text-[10px]">Param Level</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {test.isTransferredInhouse && !test.isParameterLevel && status !== "results_saved" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-primary"
                disabled={returningKey === testKey}
                onClick={(e) => {
                  e.stopPropagation();
                  returnToInhouse(regId, test.testId, test.testName);
                }}
              >
                {returningKey === testKey ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowLeftRight className="h-3 w-3" />
                )}
                Return to Inhouse
              </Button>
            )}
            {renderStatusBadge(regId, test.testId)}
          </div>
        </div>

        {/* Parameter-level: show individual outsourced parameters with return buttons */}
        {test.isParameterLevel && test.outsourcedParameterIds && test.outsourcedParameterIds.length > 0 && (
          <div className="border-t px-3 py-2 bg-muted/5">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Outsourced Parameters:</div>
            <div className="flex flex-wrap gap-1.5">
              {test.outsourcedParameterIds.map((paramId: string) => {
                const paramInfo = (testParamsMap[test.testId] || []).find(
                  (tp: any) => !tp.is_subheader && tp.report_test_parameters?.id === paramId
                );
                const paramName = paramInfo?.report_test_parameters?.parameter_name || paramId;
                const isReturning = returningKey === `${regId}||${paramId}`;
                return (
                  <div key={paramId} className="flex items-center gap-1 border rounded px-2 py-0.5 bg-background text-xs">
                    <span>{paramName}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-4 w-4 p-0 text-muted-foreground hover:text-primary"
                      title="Return to Inhouse"
                      disabled={isReturning}
                      onClick={(e) => {
                        e.stopPropagation();
                        returnParamToInhouse(regId, test.testId, paramId, paramName);
                      }}
                    >
                      {isReturning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowLeftRight className="h-3 w-3" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Expanded: only for sent tests (awaiting or results_entered) */}
        {isExpanded && (canEnterResults || status === "results_saved") && (
          <div className="border-t p-3 space-y-3 bg-muted/10">
            <Tabs defaultValue={currentMode} onValueChange={(v) => {
              if (v === "manual") setManualMode(regId, test.testId);
            }}>
              <TabsList className="h-8">
                {hasParams && (
                  <TabsTrigger value="manual" className="text-xs gap-1 h-6">
                    <Keyboard className="h-3 w-3" /> Manual Entry
                  </TabsTrigger>
                )}
                <TabsTrigger value="snip" className="text-xs gap-1 h-6">
                  <Image className="h-3 w-3" /> Snip / Image
                </TabsTrigger>
              </TabsList>

              {hasParams && (
                <TabsContent value="manual" className="mt-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs w-[80px]">Code</TableHead>
                        <TableHead className="py-1 text-xs">Parameter</TableHead>
                        <TableHead className="py-1 text-xs w-[160px]">Result</TableHead>
                        <TableHead className="py-1 text-xs w-[60px]">Unit</TableHead>
                        <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {params.map((tp: any) => {
                        if (tp.is_subheader) {
                          // For parameter-level outsource, skip subheaders
                          if (test.isParameterLevel) return null;
                          return (
                            <TableRow key={tp.id || tp.subheader_text}>
                              <TableCell colSpan={5} className="py-1 text-xs font-semibold text-primary bg-muted/30">
                                {tp.subheader_text}
                              </TableCell>
                            </TableRow>
                          );
                        }
                        const p = tp.report_test_parameters;
                        if (!p) return null;
                        // For parameter-level outsource, only show outsourced parameters
                        if (test.isParameterLevel && test.outsourcedParameterIds && !test.outsourcedParameterIds.includes(p.id)) {
                          return null;
                        }
                        const valKey = `${regId}||${p.id}`;
                        const existing = existingResults.find(
                          (r: any) => r.registration_id === regId && r.parameter_id === p.id
                        );
                        // Skip parameters that already have a result value saved
                        if (existing?.result_value && existing.result_value.trim() !== "" && editedValues[valKey] === undefined) {
                          return null;
                        }
                        const currentValue = editedValues[valKey] !== undefined ? editedValues[valKey] : (existing?.result_value || "");
                        const resolved = resolveNormalRange(p.id, entry.registration);
                        const refRange = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");

                        return (
                          <TableRow key={valKey}>
                            <TableCell className="py-1 text-xs font-mono text-muted-foreground">{p.param_code}</TableCell>
                            <TableCell className="py-1 text-sm">{p.parameter_name}</TableCell>
                            <TableCell className="py-1">
                              <Input
                                value={currentValue}
                                onChange={e => setEditedValues(prev => ({ ...prev, [valKey]: e.target.value }))}
                                className="h-7 text-sm"
                                placeholder="Enter result"
                              />
                            </TableCell>
                            <TableCell className="py-1 text-xs text-muted-foreground">{p.unit}</TableCell>
                            <TableCell className="py-1 text-xs text-muted-foreground">{refRange}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm"
                      onClick={() => saveManualResults(regId, test.testId, test.testName, test.outsourcedParameterIds, entry.registration)}
                      disabled={isSaving}
                    >
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      Save Results
                    </Button>
                  </div>
                </TabsContent>
              )}

              <TabsContent value="snip" className="mt-2 space-y-3">
                <SnipOnLetterhead
                  regId={regId}
                  testId={test.testId}
                  imageUrls={getSnipImageUrls(regId, test.testId)}
                  isUploading={isUploading}
                  onPaste={handlePaste}
                  onFileUpload={handleFileUpload}
                  onDeletePage={deleteSnipPage}
                />
                {getSnipImageUrls(regId, test.testId).length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveSnipResults(regId, test.testId, test.testName)}
                      disabled={savingKey === `${regId}||${test.testId}`}
                    >
                      {savingKey === `${regId}||${test.testId}` ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      Save Results
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Outsourced</div>
          <div className="text-xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Not Sent</div>
          <div className="text-xl font-bold text-muted-foreground">{stats.notSent}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Awaiting Results</div>
          <div className="text-xl font-bold text-amber-600">{stats.awaiting}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Results Saved</div>
          <div className="text-xl font-bold text-green-600">{stats.resultsSaved}</div>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {selectedTests.size > 0 && (
          <Button onClick={() => setShowLabDialog(true)} className="gap-1.5">
            <Send className="h-4 w-4" />
            Mark {selectedTests.size} Test{selectedTests.size > 1 ? "s" : ""} as Sent
          </Button>
        )}
      </div>

      {/* Patient list */}
      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : patientEntries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No outsourced tests found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {patientEntries.map(entry => {
            const reg = entry.registration;
            // Filter out tests where all results are already filled
            const visibleTests = entry.outsourcedTests.filter(t => {
              const status = getTestStatus(reg.id, t.testId);
              if (status === "results_saved") {
                const snip = getSnip(reg.id, t.testId);
                // For snip mode, results are complete — hide from pending list
                if (snip?.result_mode === "snip") {
                  const imageUrls = getSnipImageUrls(reg.id, t.testId);
                  // Hide if snip images exist (results are done)
                  if (imageUrls.length > 0) return false;
                }
                // For manual mode, check if all params have results
                return !hasAllResultsFilled(reg.id, t.testId, t.outsourcedParameterIds);
              }
              return true;
            });
            if (visibleTests.length === 0) return null;
            const isExpanded = expandedPatient === reg.id;
            const notSentCount = visibleTests.filter(t => getTestStatus(reg.id, t.testId) === "not_sent").length;
            const awaitingCount = visibleTests.filter(t => getTestStatus(reg.id, t.testId) === "awaiting_results").length;
            const allNotSentSelected = visibleTests
              .filter(t => getTestStatus(reg.id, t.testId) === "not_sent")
              .every(t => selectedTests.has(`${reg.id}||${t.testId}`));

            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}
                >
                  {/* Select all checkbox for not-sent tests */}
                  {notSentCount > 0 && (
                    <Checkbox
                      checked={allNotSentSelected && notSentCount > 0}
                      onCheckedChange={(checked) => toggleAllForPatient(entry, !!checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{reg.patient_name}</span>
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground font-mono">{reg.invoice_number}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reg.mobile_number} • {entry.outsourcedTests.length} test{entry.outsourcedTests.length > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {notSentCount > 0 && <Badge variant="outline" className="text-[10px]">{notSentCount} Not Sent</Badge>}
                    {awaitingCount > 0 && <Badge className="text-[10px] bg-amber-500">{awaitingCount} Awaiting</Badge>}
                    
                  </div>
                </div>
                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-3 space-y-2">
                    {visibleTests.map(test => renderTestCard(entry, test))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Lab Name Dialog */}
      <Dialog open={showLabDialog} onOpenChange={setShowLabDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Sent to Outsourced Lab</DialogTitle>
            <DialogDescription>
              Enter the name of the outsourced lab where {selectedTests.size} test{selectedTests.size > 1 ? "s are" : " is"} being sent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Outsourced Lab</Label>
            <Select value={labName} onValueChange={setLabName}>
              <SelectTrigger>
                <SelectValue placeholder="Select outsourced lab" />
              </SelectTrigger>
              <SelectContent>
                {outsourceLabs.map(lab => (
                  <SelectItem key={lab.id} value={lab.value}>{lab.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {outsourceLabs.length === 0 && (
              <p className="text-xs text-muted-foreground">No labs configured. Add them in Test Management → Settings → Outsource Labs.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLabDialog(false)}>Cancel</Button>
            <Button onClick={markAsSent} disabled={markingSent || !labName.trim()} className="gap-1.5">
              {markingSent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirm & Mark Sent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Lab Name Dialog */}
      <Dialog open={!!editLabKey} onOpenChange={(open) => { if (!open) { setEditLabKey(null); setEditLabName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Outsourced Lab Name</DialogTitle>
            <DialogDescription>Select the correct outsourced lab name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Outsourced Lab</Label>
            <Select value={editLabName} onValueChange={setEditLabName}>
              <SelectTrigger>
                <SelectValue placeholder="Select outsourced lab" />
              </SelectTrigger>
              <SelectContent>
                {outsourceLabs.map(lab => (
                  <SelectItem key={lab.id} value={lab.value}>{lab.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditLabKey(null); setEditLabName(""); }}>Cancel</Button>
            <Button onClick={saveEditLabName} disabled={savingEditLab || !editLabName.trim()} className="gap-1.5">
              {savingEditLab ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update Lab Name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OutsourcedResults;
