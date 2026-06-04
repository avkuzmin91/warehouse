# WH-00017: план и принятое → 540 на production.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$sql = Join-Path $repoRoot 'scripts\fix-receipt-wh-00017-qty-540.sql'

Write-Host '=== До правки (prod) ==='
& "$PSScriptRoot\prod-psql.ps1" -Env prod -Query @"
SELECT d.doc_number, d.status, l.product_sku, l.planned_qty, l.accepted_qty
FROM receipt_docs d
JOIN receipt_lines l ON l.doc_id = d.id
WHERE d.doc_number = 'WH-00017'
  AND COALESCE(d.is_deleted, 0) = 0
  AND COALESCE(l.is_deleted, 0) = 0;
"@

$ok = Read-Host 'Применить fix-receipt-wh-00017-qty-540.sql на prod? (y/N)'
if ($ok -notin @('y', 'Y', 'д', 'Д')) {
    Write-Host 'Отменено.'
    exit 0
}

Write-Host '=== Применение ==='
& "$PSScriptRoot\prod-psql.ps1" -Env prod -SqlFile $sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '=== После правки (prod) ==='
& "$PSScriptRoot\prod-psql.ps1" -Env prod -Query @"
SELECT d.doc_number, d.status, l.product_sku, l.planned_qty, l.accepted_qty
FROM receipt_docs d
JOIN receipt_lines l ON l.doc_id = d.id
WHERE d.doc_number = 'WH-00017'
  AND COALESCE(d.is_deleted, 0) = 0
  AND COALESCE(l.is_deleted, 0) = 0;
"@
