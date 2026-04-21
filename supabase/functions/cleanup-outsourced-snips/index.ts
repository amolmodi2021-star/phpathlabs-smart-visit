const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAGE_SIZE = 1000
const REMOVE_BATCH = 100
const BUCKET = 'outsourced-snips'

async function listAllFiles(
  supabase: any,
  prefix: string,
  collected: string[]
) {
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      console.error(`Error listing ${prefix}:`, error)
      return
    }
    if (!data || data.length === 0) return

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      // Files have an id; folders are placeholders.
      if (item.id) {
        collected.push(fullPath)
      } else if (!item.metadata || Object.keys(item.metadata).length === 0) {
        // Recurse into subfolder.
        await listAllFiles(supabase, fullPath, collected)
      }
    }

    if (data.length < PAGE_SIZE) return
    offset += data.length
    if (offset > PAGE_SIZE * 50) return
  }
}

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

    // 2. Extract storage file paths from DB-tracked snips
    const dbFilePaths: string[] = []
    if (oldSnips && oldSnips.length > 0) {
      for (const snip of oldSnips) {
        if (snip.snip_image_url) {
          const parts = snip.snip_image_url.split(`/${BUCKET}/`)
          if (parts.length > 1) {
            dbFilePaths.push(parts[1])
          }
        }
      }

      if (dbFilePaths.length > 0) {
        for (let i = 0; i < dbFilePaths.length; i += REMOVE_BATCH) {
          const chunk = dbFilePaths.slice(i, i + REMOVE_BATCH)
          const { error: storageErr } = await supabase.storage.from(BUCKET).remove(chunk)
          if (storageErr) console.error('Storage cleanup error (DB-tracked):', storageErr)
        }
      }

      // 3. Delete DB records
      const oldIds = oldSnips.map((s: any) => s.id)
      const { error: deleteErr } = await supabase
        .from('outsourced_test_snips')
        .delete()
        .in('id', oldIds)
      if (deleteErr) throw deleteErr
    }

    // 4. Defensive: recursively scan bucket for orphaned files (no DB row)
    //    older than 365 days. Future-proofs against any nested layout.
    const cutoffMs = Date.now() - 365 * 24 * 60 * 60 * 1000
    const allPaths: string[] = []
    await listAllFiles(supabase, '', allPaths)

    // Build set of paths already removed via DB step to avoid double-remove.
    const removedSet = new Set(dbFilePaths)
    let orphansRemoved = 0

    // We need created_at for each path; storage.list returns it inline so we
    // re-walk and filter in-memory. To avoid a second walk, do age filtering
    // during listing instead. Simpler: re-list each parent folder once.
    // For now, only purge if orphan path filename has a parseable old date.
    const orphanCandidates: string[] = []
    for (const p of allPaths) {
      if (removedSet.has(p)) continue
      // Filename may start with timestamp prefix `${Date.now()}_...`
      const name = p.split('/').pop() || ''
      const m = name.match(/^(\d{12,16})_/)
      if (m) {
        const ts = parseInt(m[1], 10)
        if (ts < cutoffMs) orphanCandidates.push(p)
      }
    }

    for (let i = 0; i < orphanCandidates.length; i += REMOVE_BATCH) {
      const chunk = orphanCandidates.slice(i, i + REMOVE_BATCH)
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(chunk)
      if (rmErr) {
        console.error('Orphan cleanup error:', rmErr)
      } else {
        orphansRemoved += chunk.length
      }
    }

    const summary = {
      deleted: oldSnips?.length ?? 0,
      files_removed: dbFilePaths.length,
      orphans_removed: orphansRemoved,
    }

    await supabase.from('cleanup_runs').insert({
      function_name: 'cleanup-outsourced-snips',
      summary,
    })

    console.log('Cleanup complete:', summary)
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
