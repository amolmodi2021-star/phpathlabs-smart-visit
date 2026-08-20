from pathlib import Path
import json, csv, urllib.request
from datetime import datetime, timezone

env={}
for line in Path('.env').read_text(encoding='utf-8', errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
url=env['VITE_SUPABASE_URL'].rstrip('/'); key=env['SUPABASE_SERVICE_ROLE_KEY']

def req(method, path, body=None):
    data=None if body is None else json.dumps(body).encode()
    headers={
        'apikey':key,'Authorization':'Bearer '+key,
        'Content-Type':'application/json',
        'Prefer':'return=representation',
    }
    r=urllib.request.Request(url+path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw=resp.read().decode()
        return json.loads(raw) if raw else None

def get_all(path):
    out=[]; offset=0
    while True:
        sep='&' if '?' in path else '?'
        chunk=req('GET', f'{path}{sep}limit=1000&offset={offset}')
        if not chunk: break
        out.extend(chunk)
        if len(chunk)<1000: break
        offset+=1000
    return out

def pct_discount(price, pct):
    return int(round((float(price) * float(pct)) / 100.0))

rows=get_all(
    '/rest/v1/patient_registrations'
    '?select=id,invoice_number,gross_amount,discount_amount,final_amount,paid_amount,'
    'global_discount_type,global_discount_value,tests,bill_cancelled,created_at'
    '&global_discount_value=gt.0'
    '&order=created_at.desc'
)

affected=[]
for r in rows:
    gtype=(r.get('global_discount_type') or 'percent').lower()
    gval=float(r.get('global_discount_value') or 0)
    if gval <= 0:
        continue
    tests=r.get('tests') if isinstance(r.get('tests'), list) else []
    if not tests:
        continue
    stored_sum=0.0
    recomputed=0.0
    for t in tests:
        if not isinstance(t, dict):
            continue
        price=float(t.get('price') or 0)
        stored_sum += float(t.get('discount') or 0)
        if gtype == 'percent':
            recomputed += pct_discount(price, gval)
        else:
            recomputed += min(price, gval)
    disc_amt=float(r.get('discount_amount') or 0)
    # Stale global when it disagrees with frozen line discounts or header discount_amount
    if abs(stored_sum - recomputed) <= 0.01 and (disc_amt <= 0 or abs(disc_amt - recomputed) <= 0.01):
        continue
    # Prefer line discounts as source of truth when present; else header
    truth = stored_sum if stored_sum > 0 else disc_amt
    if truth <= 0 and abs(disc_amt - recomputed) <= 0.01:
        continue
    affected.append({
        'id': r['id'],
        'invoice_number': r.get('invoice_number'),
        'created_at': r.get('created_at'),
        'bill_cancelled': bool(r.get('bill_cancelled')),
        'old_global_type': r.get('global_discount_type'),
        'old_global_value': gval,
        'gross_amount': r.get('gross_amount'),
        'discount_amount': disc_amt,
        'stored_line_discount_sum': stored_sum,
        'global_recomputed_discount': recomputed,
        'final_amount': r.get('final_amount'),
        'paid_amount': r.get('paid_amount'),
        'false_edit_overpay': max(0.0, float(r.get('paid_amount') or 0) - (float(r.get('gross_amount') or 0) - recomputed)),
    })

print(f'will_update={len(affected)}')

updated=[]
errors=[]
for a in affected:
    try:
        out=req('PATCH', f"/rest/v1/patient_registrations?id=eq.{a['id']}", {
            'global_discount_type': None,
            'global_discount_value': 0,
        })
        updated.append({**a, 'status': 'updated'})
    except Exception as e:
        errors.append({**a, 'status': 'error', 'error': str(e)})

stamp=datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
out_path=Path(f'approved_reports_heal_audit.csv')  # reuse? better dedicated
out_path=Path(f'scripts/backfill-stale-global-discount-{stamp}.csv')
fields=list(updated[0].keys()) if updated else list((affected[0].keys() if affected else ['id']))
if updated or errors:
    with out_path.open('w', newline='', encoding='utf-8') as f:
        w=csv.DictWriter(f, fieldnames=sorted({*(updated[0].keys() if updated else []), *(errors[0].keys() if errors else []), *fields}))
        w.writeheader()
        for row in updated + errors:
            w.writerow(row)

print(f'updated={len(updated)} errors={len(errors)} log={out_path}')
if updated[:5]:
    print('sample_invoices', [u['invoice_number'] for u in updated[:10]])

# verify 2608200030
v=req('GET', '/rest/v1/patient_registrations?invoice_number=eq.2608200030&select=invoice_number,discount_amount,final_amount,paid_amount,global_discount_type,global_discount_value')
print('verify_2608200030', json.dumps(v, ensure_ascii=True))
