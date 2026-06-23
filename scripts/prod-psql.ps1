# psql в контейнере Postgres на prod/test через SSH.
# Примеры:
#   .\scripts\prod-psql.ps1 -Query "SELECT doc_number, status FROM receipt_docs WHERE doc_number='WH-00017'"
#   .\scripts\prod-psql.ps1 -SqlFile scripts\fix-receipt-wh-00017-qty-540.sql
param(
    [ValidateSet('prod', 'test')]
    [string] $Env = 'prod',
    [string] $Query,
    [string] $SqlFile
)

$ErrorActionPreference = 'Stop'

$dbContainer = if ($Env -eq 'prod') { 'wms_prod_db' } else { 'wms_test_db' }
$dbName = if ($Env -eq 'prod') { 'app' } else { 'app_test' }
$sshHost = if ($Env -eq 'prod') { 'wms-prod' } else { 'wms-test' }

if ($Query -and $SqlFile) {
    Write-Error "Укажите только -Query или -SqlFile"
}
if (-not $Query -and -not $SqlFile) {
    Write-Error "Укажите -Query или -SqlFile"
}

$psqlBase = "docker exec -i $dbContainer psql -U postgres -d $dbName -v ON_ERROR_STOP=1"

if ($Query) {
    $sql = ($Query.TrimEnd(';') + ';')
    $sql | & ssh $sshHost $psqlBase
    exit $LASTEXITCODE
}

$path = Resolve-Path $SqlFile
Get-Content -Path $path -Raw | & ssh $sshHost $psqlBase
exit $LASTEXITCODE
