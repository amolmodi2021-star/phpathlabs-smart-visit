# Durable PHPL cloud migrate: loads gitignored supabase/.env.cli-auth then runs db push.
# Usage:  powershell -File scripts/supabase-db-push.ps1
# Optional: powershell -File scripts/supabase-db-push.ps1 -DryRun

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'supabase\.env.cli-auth'

if (-not (Test-Path $envFile)) {
  Write-Error 'Missing supabase/.env.cli-auth - copy .env.cli-auth.example and fill SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD.'
}

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $i = $line.IndexOf('=')
  if ($i -lt 1) { return }
  $key = $line.Substring(0, $i).Trim()
  $val = $line.Substring($i + 1).Trim()
  if ($key -and $val) {
    Set-Item -Path ('Env:' + $key) -Value $val
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Error 'SUPABASE_ACCESS_TOKEN is empty in supabase/.env.cli-auth'
}
if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Error 'SUPABASE_DB_PASSWORD is empty in supabase/.env.cli-auth'
}

$ref = if ($env:CLOUD_PROJECT_REF) { $env:CLOUD_PROJECT_REF } else { 'gqpqnfvihjjkmbcdzate' }

Set-Location $root
Write-Host ('Linking ' + $ref + ' (password from .env.cli-auth)...')
& npx --yes supabase link --project-ref $ref --password $env:SUPABASE_DB_PASSWORD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Pushing migrations...'
if ($DryRun) {
  & npx --yes supabase db push --linked --dry-run
} else {
  & npx --yes supabase db push --linked
}
exit $LASTEXITCODE