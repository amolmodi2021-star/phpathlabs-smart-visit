import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const url = new URL(req.url);

    // GET: Query tests for a sample_id, optionally filtered by machine_id
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      const sampleId = url.searchParams.get("sample_id");
      const machineId = url.searchParams.get("machine_id") || "";

      if (action !== "query" || !sampleId) {
        return new Response(
          JSON.stringify({ error: "Required: ?action=query&sample_id=XXX" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const requestBody = { action: "query", sample_id: sampleId, machine_id: machineId };

      // Find order by sample_id
      const { data: orders, error: orderErr } = await supabase
        .from("lims_test_orders")
        .select("*")
        .eq("sample_id", sampleId)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (orderErr) throw orderErr;

      if (!orders || orders.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: "No pending orders found" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const order = orders[0];
      const tests = (order.tests as any[]) || [];
      const pendingTests = tests.filter((t: any) => t.status !== "completed");

      if (pendingTests.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: "All tests already completed" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark order as in_progress
      if (order.status === "pending") {
        await supabase.from("lims_test_orders").update({ status: "in_progress" }).eq("id", order.id);
      }

      // Enrich tests with machine_id from tests/parameters tables
      const testCodes = pendingTests.map((t: any) => t.code).filter(Boolean);
      let machineMap: Record<string, string> = {};
      let reverseCodeMap: Record<string, string> = {};
      if (testCodes.length > 0) {
        const { data: testRows } = await supabase
          .from("tests").select("test_code, machine_id").in("test_code", testCodes);
        if (testRows) {
          for (const row of testRows) {
            if (row.test_code && row.machine_id) machineMap[row.test_code] = row.machine_id;
          }
        }
        const missingCodes = testCodes.filter((c: string) => !machineMap[c]);
        if (missingCodes.length > 0) {
          const { data: paramRows } = await supabase
            .from("report_test_parameters").select("param_code, machine_id").in("param_code", missingCodes);
          if (paramRows) {
            for (const row of paramRows) {
              if (row.param_code && row.machine_id) machineMap[row.param_code] = row.machine_id;
            }
          }
        }

        // Reverse-lookup: internal code (PRM####) -> machine_code (WBC, RBC, etc.)
        let mappingQuery = supabase
          .from("lims_code_mapping")
          .select("machine_code, mapped_param_code, mapped_test_code, machine_id")
          .or(`mapped_param_code.in.(${testCodes.join(",")}),mapped_test_code.in.(${testCodes.join(",")})`);
        if (machineId) {
          mappingQuery = mappingQuery.eq("machine_id", machineId);
        }
        const { data: codeMappings } = await mappingQuery;
        if (codeMappings) {
          for (const m of codeMappings) {
            if (m.machine_code && m.mapped_param_code && !reverseCodeMap[m.mapped_param_code]) {
              reverseCodeMap[m.mapped_param_code] = m.machine_code;
            }
            if (m.machine_code && m.mapped_test_code && !reverseCodeMap[m.mapped_test_code]) {
              reverseCodeMap[m.mapped_test_code] = m.machine_code;
            }
          }
        }
      }

      // Build enriched test list — send machine_code to middleware (fallback to internal code)
      const enrichedTests = pendingTests.map((t: any) => ({
        code: reverseCodeMap[t.code] || t.code,
        internal_code: t.code,
        name: t.name,
        unit: t.unit || "",
        machine_id: t.machine_id || machineMap[t.code] || "",
      }));

      // Filter by machine_id if provided
      const filteredTests = machineId
        ? enrichedTests.filter((t) => t.machine_id === machineId)
        : enrichedTests;

      if (filteredTests.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: machineId ? `No tests for machine ${machineId}` : "No pending tests" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const responseBody = {
        order_id: order.id,
        sample_id: order.sample_id,
        patient_name: order.patient_name,
        tests: filteredTests,
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
        request_body: requestBody, response_body: responseBody, machine_id: machineId,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST: Submit results with code mapping
    if (req.method === "POST") {
      const body = await req.json();
      const { action, sample_id, order_id, results, machine_id: bodyMachineId } = body;

      if (action !== "results" || !sample_id || !Array.isArray(results)) {
        return new Response(
          JSON.stringify({ error: "Required: {action:'results', sample_id, results:[...]}" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const machineId = bodyMachineId || "";

      // Find matching order
      let orderId = order_id;
      if (!orderId) {
        const { data: orders } = await supabase
          .from("lims_test_orders").select("id")
          .eq("sample_id", sample_id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false }).limit(1);
        orderId = orders?.[0]?.id || null;
      }

      // Fetch all code mappings for the incoming codes
      const incomingCodes = results.map((r: any) => r.code || r.test_code || "").filter(Boolean);
      let codeMap: Record<string, { mapped_param_code: string; mapped_test_code: string; parameter_name: string }> = {};
      if (incomingCodes.length > 0) {
        const { data: mappings } = await supabase
          .from("lims_code_mapping").select("machine_code, mapped_param_code, mapped_test_code, parameter_name")
          .in("machine_code", incomingCodes);
        if (mappings) {
          for (const m of mappings) {
            codeMap[m.machine_code] = { mapped_param_code: m.mapped_param_code, mapped_test_code: m.mapped_test_code, parameter_name: m.parameter_name };
          }
        }
      }

      const mappedRows: any[] = [];
      const unmappedRows: any[] = [];

      for (const r of results) {
        const code = r.code || r.test_code || "";
        const mapping = codeMap[code];

        if (mapping && (mapping.mapped_param_code || mapping.mapped_test_code)) {
          // Mapped result — insert into lims_test_results with mapped code
          mappedRows.push({
            order_id: orderId,
            sample_id,
            test_code: mapping.mapped_param_code || mapping.mapped_test_code || code,
            test_name: mapping.parameter_name || r.name || r.test_name || "",
            result_value: String(r.value ?? r.result_value ?? ""),
            unit: r.unit || "",
            reference_range: r.reference_range || r.normal_range || "",
            flag: r.flag || "Normal",
          });
        } else {
          // Unmapped result — store for manual mapping
          unmappedRows.push({
            sample_id,
            order_id: orderId,
            machine_code: code,
            machine_id: machineId,
            result_value: String(r.value ?? r.result_value ?? ""),
            unit: r.unit || "",
            reference_range: r.reference_range || r.normal_range || "",
            flag: r.flag || "Normal",
          });
        }
      }

      // Insert mapped results
      if (mappedRows.length > 0) {
        const { error: insertErr } = await supabase.from("lims_test_results").insert(mappedRows);
        if (insertErr) throw insertErr;
      }

      // Insert unmapped results
      if (unmappedRows.length > 0) {
        const { error: unmappedErr } = await supabase.from("lims_unmapped_results").insert(unmappedRows);
        if (unmappedErr) throw unmappedErr;
      }

      // ===== Bridge mapped results into patient_results (Results Entry UI) =====
      let patientResultsWritten = 0;
      let registrationResolved = false;
      try {
        // 1) Resolve registration_id from sample_id (strip trailing letter suffix)
        const invoiceNumber = sample_id.replace(/[A-Za-z]+$/, "");
        const { data: regRows } = await supabase
          .from("patient_registrations")
          .select("id, tests")
          .eq("invoice_number", invoiceNumber)
          .limit(1);
        const registration = regRows?.[0];

        if (registration && mappedRows.length > 0) {
          registrationResolved = true;
          const registrationId = registration.id;
          const regTestIds = new Set(((registration.tests as any[]) || []).map((t: any) => t.test_id || t.id).filter(Boolean));

          // 2) Resolve parameters by param_code
          const paramCodes = Array.from(new Set(mappedRows.map((r) => r.test_code).filter(Boolean)));
          const { data: paramRows } = await supabase
            .from("report_test_parameters")
            .select("id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text")
            .in("param_code", paramCodes);
          const paramByCode: Record<string, any> = {};
          for (const p of paramRows || []) paramByCode[p.param_code] = p;

          // Resolve test_id via test_parameters junction; prefer tests present in registration
          const paramIds = (paramRows || []).map((p) => p.id);
          let tpRows: any[] = [];
          if (paramIds.length > 0) {
            const { data } = await supabase
              .from("test_parameters")
              .select("test_id, parameter_id")
              .in("parameter_id", paramIds);
            tpRows = data || [];
          }
          const testIdsByParam: Record<string, string[]> = {};
          for (const tp of tpRows) {
            if (!testIdsByParam[tp.parameter_id]) testIdsByParam[tp.parameter_id] = [];
            testIdsByParam[tp.parameter_id].push(tp.test_id);
          }

          // 3) Fetch existing patient_results for this registration to decide insert vs update vs skip
          const { data: existingRows } = await supabase
            .from("patient_results")
            .select("id, parameter_id, status, result_value")
            .eq("registration_id", registrationId);
          const existingByParam: Record<string, any> = {};
          for (const er of existingRows || []) existingByParam[er.parameter_id] = er;

          const insertPayload: any[] = [];
          for (const mr of mappedRows) {
            const param = paramByCode[mr.test_code];
            if (!param) continue;
            const candidateTestIds = testIdsByParam[param.id] || [];
            const testId = candidateTestIds.find((tid) => regTestIds.has(tid)) || candidateTestIds[0];
            if (!testId) continue;

            // Compute flag from numeric range when possible
            const numericVal = parseFloat(mr.result_value);
            let flag = mr.flag || "";
            if (!isNaN(numericVal) && param.normal_range_low != null && param.normal_range_high != null) {
              if (numericVal < Number(param.normal_range_low)) flag = "L";
              else if (numericVal > Number(param.normal_range_high)) flag = "H";
              else flag = "N";
            }

            const referenceRange = param.normal_range_text
              || (param.normal_range_low != null && param.normal_range_high != null
                  ? `${param.normal_range_low} - ${param.normal_range_high}`
                  : "");

            const existing = existingByParam[param.id];
            const nowIso = new Date().toISOString();
            if (existing) {
              // Skip if technician/verifier/approver already worked on it
              if (existing.status && existing.status !== "pending") continue;
              const { error: updErr } = await supabase
                .from("patient_results")
                .update({
                  result_value: mr.result_value,
                  flag,
                  unit: mr.unit || param.unit || "",
                  reference_range: referenceRange,
                  normal_range_low: param.normal_range_low,
                  normal_range_high: param.normal_range_high,
                  is_from_interface: true,
                  entered_at: nowIso,
                  entered_by: "INTERFACE",
                  status: "pending",
                  updated_at: nowIso,
                })
                .eq("id", existing.id);
              if (!updErr) patientResultsWritten++;
            } else {
              insertPayload.push({
                registration_id: registrationId,
                test_id: testId,
                parameter_id: param.id,
                param_code: param.param_code,
                parameter_name: param.parameter_name,
                result_value: mr.result_value,
                unit: mr.unit || param.unit || "",
                reference_range: referenceRange,
                normal_range_low: param.normal_range_low,
                normal_range_high: param.normal_range_high,
                flag,
                status: "pending",
                is_from_interface: true,
                entered_at: nowIso,
                entered_by: "INTERFACE",
              });
            }
          }

          if (insertPayload.length > 0) {
            const { error: insErr } = await supabase.from("patient_results").insert(insertPayload);
            if (!insErr) patientResultsWritten += insertPayload.length;
            else console.error("patient_results insert error:", insErr);
          }
        }
      } catch (bridgeErr) {
        console.error("patient_results bridge error:", bridgeErr);
      }

      // Update order: mark individual tests as completed for mapped results
      if (orderId && mappedRows.length > 0) {
        const { data: order } = await supabase
          .from("lims_test_orders").select("tests").eq("id", orderId).single();

        if (order) {
          const tests = (order.tests as any[]) || [];
          const mappedCodes = new Set(mappedRows.map((r) => r.test_code));
          // Also match by original incoming code for direct matches
          const originalCodes = new Set(results.filter((r: any) => {
            const code = r.code || r.test_code || "";
            return codeMap[code] && (codeMap[code].mapped_param_code || codeMap[code].mapped_test_code);
          }).map((r: any) => r.code || r.test_code || ""));

          const updatedTests = tests.map((t: any) => ({
            ...t,
            status: (mappedCodes.has(t.code) || originalCodes.has(t.code)) ? "completed" : (t.status || "pending"),
          }));

          const allDone = updatedTests.every((t: any) => t.status === "completed");
          await supabase.from("lims_test_orders").update({
            tests: updatedTests,
            status: allDone ? "completed" : "in_progress",
          }).eq("id", orderId);
        }
      }

      const responseBody = {
        success: true,
        sample_id,
        results_received: results.length,
        mapped: mappedRows.length,
        unmapped: unmappedRows.length,
        order_id: orderId,
        registration_resolved: registrationResolved,
        patient_results_written: patientResultsWritten,
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id, direction: "incoming", event_type: "submit_results",
        request_body: body, response_body: responseBody, machine_id: machineId,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("lims-interface error:", err);
    return new Response(
      JSON.stringify({ error: true, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
