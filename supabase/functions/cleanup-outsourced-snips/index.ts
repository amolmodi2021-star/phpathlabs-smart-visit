const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 365)
    const cutoffISO = cutoffDate.toISOString()

    // 1. Find snip records older than 365 days
    const { data: oldSnips, error: fetchErr } = await supabase
      .from('outsourced_test_snips')
      .select('id, snip_image_url')
      .lt('created_at', cutoffISO)
      .not('snip_image_url', 'is', null)

    if (fetchErr) throw fetchErr

    if (!oldSnips || oldSnips.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, message: 'No old snips to clean up' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Extract storage file paths and delete from bucket
    const filePaths: string[] = []
    for (const snip of oldSnips) {
      if (snip.snip_image_url) {
        // URL format: .../storage/v1/object/public/outsourced-snips/filename
        const parts = snip.snip_image_url.split('/outsourced-snips/')
        if (parts.length > 1) {
          filePaths.push(parts[1])
        }
      }
    }

    if (filePaths.length > 0) {
      const { error: storageErr } = await supabase.storage
        .from('outsourced-snips')
        .remove(filePaths)
      if (storageErr) {
        console.error('Storage cleanup error:', storageErr)
      }
    }

    // 3. Delete DB records
    const oldIds = oldSnips.map((s: any) => s.id)
    const { error: deleteErr } = await supabase
      .from('outsourced_test_snips')
      .delete()
      .in('id', oldIds)

    if (deleteErr) throw deleteErr

    await supabase.from("cleanup_runs").insert({
      function_name: "cleanup-outsourced-snips",
      summary: { deleted: oldIds.length, files_removed: filePaths.length },
    });

    return new Response(
      JSON.stringify({ deleted: oldIds.length, files_removed: filePaths.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
