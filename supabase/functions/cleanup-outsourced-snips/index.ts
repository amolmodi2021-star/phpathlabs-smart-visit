const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAGE_SIZE = 1000
const REMOVE_BATCH = 100
const BUCKET = 'outsourced-snips'
const DEFAULT_MAX_AGE_DAYS = 30
const MAX_RECURSION_DEPTH = 5

interface FileEntry {
  path: string
  createdAt: string | null
}

async function walkBucket(
  supabase: any,
  prefix: string,
  collected: FileEntry[],
  depth: number
) {
  if (depth > MAX_RECURSION_DEPTH) return
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      console.error(`Error listing "${prefix}":`, error)
      return
    }
    if (!data || data.length === 0) return

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id) {
        // Real file
        collected.push({
          path: fullPath,
          createdAt: item.created_at ?? item.updated_at ?? null,
        })
      } else {
        // Folder placeholder — recurse
        await walkBucket(supabase, fullPath, collected, depth + 1)
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

    // Parse optional body { max_age_days: N }
    let maxAgeDays = DEFAULT_MAX_AGE_DAYS
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => null)
        if (body && typeof body.max_age_days === 'number' && body.max_age_days >= 0) {
          maxAgeDays = body.max_age_days
        }
      }
    } catch {
      // ignore
    }

    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

    // 1. Walk the entire bucket recursively
    const allFiles: FileEntry[] = []
    await walkBucket(supabase, '', allFiles, 0)

    // 2. Filter by created_at age
    const toDelete: string[] = []
    let skippedRecent = 0
    let skippedNoDate = 0
    for (const f of allFiles) {
      if (!f.createdAt) {
        skippedNoDate++
        continue
      }
      const ts = new Date(f.createdAt).getTime()
      if (Number.isNaN(ts)) {
        skippedNoDate++
        continue
      }
      if (ts < cutoffMs) {
        toDelete.push(f.path)
      } else {
        skippedRecent++
      }
    }

    // 3. Batch-delete from storage
    let filesRemoved = 0
    for (let i = 0; i < toDelete.length; i += REMOVE_BATCH) {
      const chunk = toDelete.slice(i, i + REMOVE_BATCH)
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(chunk)
      if (rmErr) {
        console.error('Storage remove error:', rmErr)
      } else {
        filesRemoved += chunk.length
      }
    }

    // 4. Best-effort: also clean DB rows whose snip_image_url points to deleted files
    let dbRowsDeleted = 0
    if (toDelete.length > 0) {
      const removedSet = new Set(toDelete)
      const { data: dbRows } = await supabase
        .from('outsourced_test_snips')
        .select('id, snip_image_url')
        .not('snip_image_url', 'is', null)
      const idsToDelete: string[] = []
      if (dbRows) {
        for (const r of dbRows as any[]) {
          if (!r.snip_image_url) continue
          const parts = String(r.snip_image_url).split(`/${BUCKET}/`)
          if (parts.length > 1 && removedSet.has(parts[1])) {
            idsToDelete.push(r.id)
          }
        }
      }
      if (idsToDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('outsourced_test_snips')
          .delete()
          .in('id', idsToDelete)
        if (delErr) {
          console.error('DB row cleanup error:', delErr)
        } else {
          dbRowsDeleted = idsToDelete.length
        }
      }
    }

    const summary = {
      max_age_days: maxAgeDays,
      scanned: allFiles.length,
      files_removed: filesRemoved,
      deleted: filesRemoved,
      skipped_recent: skippedRecent,
      skipped_no_date: skippedNoDate,
      db_rows_deleted: dbRowsDeleted,
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
    console.error('Cleanup failed:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
