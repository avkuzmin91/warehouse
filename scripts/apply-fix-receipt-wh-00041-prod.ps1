# WH-00041: восстановить журнальный приход (503 шт.) и закрыть легаси-поступление (on_intake -> done) на prod.
# Кириллица доставляется файлом через scp (побайтно), минуя порчу не-ASCII при пайпе через ssh.
$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path $PSScriptRoot -Parent
$sql        = Join-Path $repoRoot 'scripts\fix-receipt-wh-00041-journal-done.sql'
$sshHost    = 'wms-prod'
$dbContainer = 'wms_prod_db'
$dbName     = 'app'
$remoteSql  = '/tmp/fix-receipt-wh-00041-journal-done.sql'

$docId  = 'f09704f5-b314-454c-998c-47cf10ff2c4c'
$lineId = 'dbec9f72-f14e-4cab-9b30-726dc3ff9290'

function Invoke-ProdSql([string] $q) {
    ($q.TrimEnd(';') + ';') | & ssh $sshHost "docker exec -i $dbContainer psql -U postgres -d $dbName -v ON_ERROR_STOP=1"
}

Write-Host '=== ДО правки: документ и строка ==='
Invoke-ProdSql @"
SELECT d.doc_number, d.status, l.planned_qty, l.accepted_qty, l.storage_zone_name
FROM receipt_docs d JOIN receipt_lines l ON l.doc_id = d.id
WHERE d.id = '$docId' AND COALESCE(l.is_deleted,0) = 0
"@

Write-Host '=== ДО правки: журнальные движения по строке (ожидается 0) ==='
Invoke-ProdSql "SELECT COUNT(*) AS journal_rows FROM zone_relocations WHERE receipt_line_id = '$lineId'"

$ok = Read-Host 'Применить восстановление прихода + закрытие WH-00041 на prod? (y/N)'
if ($ok -notin @('y', 'Y', 'д', 'Д')) {
    Write-Host 'Отменено.'
    exit 0
}

Write-Host '=== Доставка SQL на сервер (scp) ==='
& scp $sql "${sshHost}:${remoteSql}"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp не удался'; exit $LASTEXITCODE }

Write-Host '=== Применение (транзакция с защитой) ==='
& ssh $sshHost "docker exec -i $dbContainer psql -U postgres -d $dbName -v ON_ERROR_STOP=1 < $remoteSql"
$applyCode = $LASTEXITCODE
& ssh $sshHost "rm -f $remoteSql" | Out-Null
if ($applyCode -ne 0) { Write-Error 'Применение не удалось — транзакция откачена'; exit $applyCode }

Write-Host '=== ПОСЛЕ правки: документ ==='
Invoke-ProdSql @"
SELECT d.doc_number, d.status, l.planned_qty, l.accepted_qty
FROM receipt_docs d JOIN receipt_lines l ON l.doc_id = d.id
WHERE d.id = '$docId' AND COALESCE(l.is_deleted,0) = 0
"@

Write-Host '=== ПОСЛЕ правки: остаток по строке (storage/good нетто) ==='
Invoke-ProdSql @"
SELECT to_zone_name,
       SUM(CASE WHEN to_op='storage' AND to_quality='good' THEN qty ELSE 0 END)
     - SUM(CASE WHEN from_op='storage' AND from_quality='good' THEN qty ELSE 0 END) AS storage_good_net
FROM zone_relocations WHERE receipt_line_id = '$lineId' GROUP BY to_zone_name
"@
