# Закрыть исторические поступления в легаси-статусе on_intake «На приёмке» (-> cancelled) на prod.
# Кириллица доставляется файлом через scp (побайтно), минуя порчу не-ASCII при пайпе через ssh.
$ErrorActionPreference = 'Stop'
$repoRoot    = Split-Path $PSScriptRoot -Parent
$sql         = Join-Path $repoRoot 'scripts\cancel-legacy-on-intake-receipts-prod.sql'
$sshHost     = 'wms-prod'
$dbContainer = 'wms_prod_db'
$dbName      = 'app'
$remoteSql   = '/tmp/cancel-legacy-on-intake-receipts-prod.sql'

function Invoke-ProdSql([string] $q) {
    ($q.TrimEnd(';') + ';') | & ssh $sshHost "docker exec -i $dbContainer psql -U postgres -d $dbName -v ON_ERROR_STOP=1"
}

Write-Host '=== ДО правки: документы в on_intake ==='
Invoke-ProdSql @"
SELECT d.doc_number, d.status, d.arrival_date,
       COALESCE(SUM(l.planned_qty), 0) AS planned_qty,
       COALESCE(SUM(l.accepted_qty), 0) AS accepted_qty
FROM receipt_docs d
LEFT JOIN receipt_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status = 'on_intake'
GROUP BY d.doc_number, d.status, d.arrival_date
ORDER BY d.arrival_date
"@

Write-Host '=== ДО правки: журнальные движения по их строкам (ожидается 0) ==='
Invoke-ProdSql @"
SELECT COUNT(*) AS journal_rows
FROM zone_relocations zr
JOIN receipt_lines l ON l.id = zr.receipt_line_id
JOIN receipt_docs d ON d.id = l.doc_id
WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status = 'on_intake'
"@

$ok = Read-Host 'Аннулировать эти поступления на prod? (y/N)'
if ($ok -notin @('y', 'Y', 'д', 'Д')) {
    Write-Host 'Отменено.'
    exit 1
}

& scp $sql "${sshHost}:$remoteSql"
& ssh $sshHost "docker exec -i $dbContainer psql -U postgres -d $dbName -v ON_ERROR_STOP=1 < $remoteSql; rm -f $remoteSql"
