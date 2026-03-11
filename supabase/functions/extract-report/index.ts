import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, testParameters } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const paramList = (testParameters || [])
      .map((p: any) => `${p.parameter_name}|${p.unit || ''}|${p.normal_range_low ?? ''}|${p.normal_range_high ?? ''}|${p.department || ''}|${p.profile || ''}`)
      .join("\n");

    const systemPrompt = `You are an expert pathology report data extractor. Extract ALL data from the uploaded pathology report pages.

EXTRACTION RULES:
1. Extract patient demographics: name, age, gender, UMR ID (if present), referring doctor, collection date, report date
2. Extract additional registration info: Reg.No (Registration Number), Reg.Date (Registration Date), Sample Collection Date/Time, Accession Date, Authentication Date, Print Date, Location
3. Extract ALL test results with: test/parameter name, result value, unit, reference/normal range
4. Detect ALL pathologist/doctor names from signature areas or footers - there may be MULTIPLE doctors who approved different sections of the report
5. Clean numeric values: remove flags like H, L, *, etc. Keep the raw numeric value
6. Parse ranges: "12-15" → low=12, high=15. "<200" → low=0, high=200. ">40" → low=40, high=null
7. Identify department for each test (Biochemistry, Haematology, Immunology, Microbiology, etc.)
8. Identify if tests belong to a profile (e.g., Lipid Profile, Liver Function Test, Renal Function Test, CBC, Thyroid Profile)
9. For each result, determine if it's abnormal: H (high - result above normal_range_high), L (low - result below normal_range_low), or N (normal - within range)

CRITICAL - MULTIPLE PATHOLOGISTS/DOCTORS:
- A single report PDF may have MULTIPLE doctors/pathologists who have approved DIFFERENT test sections
- Each doctor's name typically appears near a signature at the bottom of a section or page
- For EACH test result, identify which doctor/pathologist approved it based on proximity to signatures
- Set the "approved_by" field for each test result with the name of the approving doctor
- If only one doctor is found, assign that doctor to all test results
- Look for names near signatures, stamps, or "Verified by", "Approved by", "Authorized by", "Pathologist" labels

CRITICAL - UMR ID RULES:
- UMR ID is a UNIQUE MEDICAL RECORD number, typically starting with "UMR" followed by digits (e.g., UMR0001234)
- Do NOT confuse "Reg.No", "Registration Number", "Invoice Number", "Bill Number", or "Lab Number" with UMR ID - these are different identifiers
- ONLY extract umr_id if you find a field explicitly labeled "UMR" or "UMR ID" or "Unique Medical Record"
- If no UMR ID is found, return umr_id as empty string ""

CRITICAL - REG.NO RULES:
- Reg.No is the Registration Number shown at the top of the report (e.g., "2603110018")
- This is DIFFERENT from UMR ID. Always capture it separately.
- Reg.Date is the registration date/time shown next to Reg.No

CRITICAL - REF. DOCTOR RULES:
- Look for fields labeled "Ref. Doctor", "Referring Doctor", "Ref. By", "Referred By", "Doctor", "Consultant", "Clinician"
- This is the name of the doctor who referred/ordered the tests
- If the report shows "SELF" or "Self Referral", return "SELF"
- Do NOT leave this empty if a doctor name is visible anywhere on the report

CRITICAL - COLLECTION DATE & REPORT DATE RULES:
- collection_date: Look for "Collection Date", "Sample Collection Date", "Collected On", "Date of Collection". Extract the DATE portion.
- report_date: Look for "Report Date", "Reported On", "Date of Report", "Reporting Date", "Authentication Date". Extract the DATE portion.
- If "Sample Collection Date" is found, copy it to BOTH sample_collection_date AND collection_date fields
- If "Authentication Date" or "Report Date" is found, copy it to BOTH the specific field AND report_date
- NEVER leave collection_date and report_date empty if sample_collection_date or authentication_date have values

CRITICAL - ABNORMAL FLAG RULES:
- Compare each numeric result_value against normal_range_low and normal_range_high
- If result_value > normal_range_high → flag = "H"
- If result_value < normal_range_low → flag = "L"  
- Otherwise → flag = "N"
- Always set a flag for every test result

KNOWN TEST PARAMETERS IN OUR SYSTEM (try to match extracted tests to these):
${paramList || 'No parameters configured yet'}

MATCHING RULES:
- Use fuzzy matching for parameter names
- Common abbreviations: CBC=Complete Blood Count, LFT=Liver Function Test, KFT=Kidney/Renal Function Test, TFT=Thyroid Function Test
- Match extracted parameters to the closest known parameter name`;

    const imageContents = (pageImages || []).map((img: string) => ({
      type: "image_url",
      image_url: { url: img }
    }));

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all patient information and test results from this pathology report. Pay special attention to identifying ALL approving doctors/pathologists and which tests each one approved. Return structured data." },
              ...imageContents,
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_report_data",
            description: "Extract structured pathology report data with per-test pathologist attribution",
            parameters: {
              type: "object",
              properties: {
                patient: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    age: { type: "string" },
                    gender: { type: "string" },
                    umr_id: { type: "string", description: "UMR (Unique Medical Record) ID only. Do NOT use Reg.No, Invoice No, Bill No, or Lab No. Return empty string if no UMR field found." },
                    reg_no: { type: "string", description: "Registration Number (Reg.No) from the report header. This is different from UMR ID." },
                    reg_date: { type: "string", description: "Registration Date (Reg.Date) from the report header, include time if shown." },
                    sample_collection_date: { type: "string", description: "Sample Collection Date/Time as shown in the report." },
                    accession_date: { type: "string", description: "Accession Date/Time as shown in the report." },
                    authentication_date: { type: "string", description: "Authentication Date/Time as shown in the report." },
                    print_date: { type: "string", description: "Print Date/Time as shown in the report." },
                    location: { type: "string", description: "Location/Branch shown in the report." },
                    ref_doctor: { type: "string", description: "Referring doctor name. Look for 'Ref. Doctor', 'Referring Doctor', 'Ref. By', 'Referred By', 'Consultant'. Return 'SELF' if self-referral. NEVER leave empty if a doctor name is visible." },
                    collection_date: { type: "string", description: "Sample/specimen collection date. Look for 'Collection Date', 'Sample Collection Date', 'Collected On'. If sample_collection_date is found, copy the same value here too." },
                    report_date: { type: "string", description: "Report/result date. Look for 'Report Date', 'Reported On', 'Authentication Date'. If authentication_date is found, copy the same value here too." },
                  },
                  required: ["name"],
                },
                test_results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      department: { type: "string", description: "Lab department like Biochemistry, Haematology, etc." },
                      profile_name: { type: "string", description: "Test profile/panel grouping ONLY if explicitly shown in the report as a section header (e.g. 'Lipid Profile', 'Liver Function Test', 'CBC'). Do NOT put individual test names here. Leave empty if the test is not under a named profile section." },
                      test_name: { type: "string", description: "The test or sub-test name. For standalone tests, this equals parameter_name." },
                      parameter_name: { type: "string" },
                      result_value: { type: "string" },
                      unit: { type: "string" },
                      normal_range_low: { type: "string" },
                      normal_range_high: { type: "string" },
                      normal_range_text: { type: "string", description: "Full range text as shown in report" },
                      flag: { type: "string", enum: ["H", "L", "N"] },
                      matched_parameter_id: { type: "string", description: "ID of matched parameter from our system" },
                      approved_by: { type: "string", description: "Name of the doctor/pathologist who approved/verified this specific test result. Look for signatures near the test section. If multiple doctors exist in the report, assign the correct one based on proximity." },
                    },
                    required: ["parameter_name", "result_value"],
                  },
                },
                pathologist_names: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of ALL pathologist/doctor names found in the report who have approved/signed any section. Include all unique names."
                },
                pathologist_name: { type: "string", description: "Primary pathologist name (for backward compatibility)" },
              },
              required: ["patient", "test_results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_report_data" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured data returned from AI");

    const extracted = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(extracted), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("extract-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
