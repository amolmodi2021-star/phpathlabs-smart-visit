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

    // GET: Query tests for a sample_id
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      const sampleId = url.searchParams.get("sample_id");

      if (action !== "query" || !sampleId) {
        return new Response(
          JSON.stringify({ error: "Required: ?action=query&sample_id=XXX" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
          sample_id: sampleId,
          direction: "outgoing",
          event_type: "query_tests",
          request_body: { action: "query", sample_id: sampleId },
          response_body: responseBody,
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
          request_body: { action: "query", sample_id: sampleId }, response_body: responseBody,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark order as in_progress
      if (order.status === "pending") {
        await supabase
          .from("lims_test_orders")
          .update({ status: "in_progress" })
          .eq("id", order.id);
      }

      // Enrich tests with machine_id: prefer order JSON, fallback to tests table then parameters table
      const testCodes = pendingTests.map((t: any) => t.code).filter(Boolean);
      let machineMap: Record<string, string> = {};
      if (testCodes.length > 0) {
        // Fallback 1: tests table (for test codes like TSTxxxx)
        const { data: testRows } = await supabase
          .from("tests")
          .select("test_code, machine_id")
          .in("test_code", testCodes);
        if (testRows) {
          for (const row of testRows) {
            if (row.test_code && row.machine_id) machineMap[row.test_code] = row.machine_id;
          }
        }
        // Fallback 2: report_test_parameters table (for param codes like PRMxxxx)
        const missingCodes = testCodes.filter((c: string) => !machineMap[c]);
        if (missingCodes.length > 0) {
          const { data: paramRows } = await supabase
            .from("report_test_parameters")
            .select("param_code, machine_id")
            .in("param_code", missingCodes);
          if (paramRows) {
            for (const row of paramRows) {
              if (row.param_code && row.machine_id) machineMap[row.param_code] = row.machine_id;
            }
          }
        }
      }

      const responseBody = {
        order_id: order.id,
        sample_id: order.sample_id,
        patient_name: order.patient_name,
        tests: pendingTests.map((t: any) => ({
          code: t.code,
          name: t.name,
          unit: t.unit || "",
          machine_id: t.machine_id || machineMap[t.code] || "",
        })),
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id: sampleId,
        direction: "outgoing",
        event_type: "query_tests",
        request_body: { action: "query", sample_id: sampleId },
        response_body: responseBody,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST: Submit results
    if (req.method === "POST") {
      const body = await req.json();
      const { action, sample_id, order_id, results } = body;

      if (action !== "results" || !sample_id || !Array.isArray(results)) {
        return new Response(
          JSON.stringify({ error: "Required: {action:'results', sample_id, results:[...]}" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find matching order
      let orderId = order_id;
      if (!orderId) {
        const { data: orders } = await supabase
          .from("lims_test_orders")
          .select("id")
          .eq("sample_id", sample_id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(1);

        orderId = orders?.[0]?.id || null;
      }

      // Insert results
      const resultRows = results.map((r: any) => ({
        order_id: orderId,
        sample_id,
        test_code: r.code || r.test_code || "",
        test_name: r.name || r.test_name || "",
        result_value: String(r.value ?? r.result_value ?? ""),
        unit: r.unit || "",
        reference_range: r.reference_range || r.normal_range || "",
        flag: r.flag || "Normal",
      }));

      const { error: insertErr } = await supabase
        .from("lims_test_results")
        .insert(resultRows);

      if (insertErr) throw insertErr;

      // Update order: mark individual tests as completed and update order status
      if (orderId) {
        const { data: order } = await supabase
          .from("lims_test_orders")
          .select("tests")
          .eq("id", orderId)
          .single();

        if (order) {
          const tests = (order.tests as any[]) || [];
          const resultCodes = new Set(results.map((r: any) => r.code || r.test_code || ""));

          const updatedTests = tests.map((t: any) => ({
            ...t,
            status: resultCodes.has(t.code) ? "completed" : (t.status || "pending"),
          }));

          const allDone = updatedTests.every((t: any) => t.status === "completed");

          await supabase
            .from("lims_test_orders")
            .update({
              tests: updatedTests,
              status: allDone ? "completed" : "in_progress",
            })
            .eq("id", orderId);
        }
      }

      const responseBody = {
        success: true,
        sample_id,
        results_received: results.length,
        order_id: orderId,
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id,
        direction: "incoming",
        event_type: "submit_results",
        request_body: body,
        response_body: responseBody,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("lims-interface error:", err);
    return new Response(
      JSON.stringify({ error: true, message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
