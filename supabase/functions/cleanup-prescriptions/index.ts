const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAGE_SIZE = 1000
const REMOVE_BATCH = 100
const BUCKET = 'prescriptions'
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
        collected.push({
          path: fullPath,
          createdAt: item.created_at ?? item.updated_at ?? null,
        })
      } else {
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

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

    const allFiles: FileEntry[] = []
    await walkBucket(supabase, '', allFiles, 0)

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

    const summary = {
      max_age_days: maxAgeDays,
      scanned: allFiles.length,
      files_removed: filesRemoved,
      deleted: filesRemoved,
      skipped_recent: skippedRecent,
      skipped_no_date: skippedNoDate,
    }

    await supabase.from('cleanup_runs').insert({
      function_name: 'cleanup-prescriptions',
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
