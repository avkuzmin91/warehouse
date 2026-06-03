# Выполнить команду на VPS в каталоге деплоя (prod или test).
# Примеры:
#   .\scripts\prod-remote.ps1 prod docker ps --format "{{.Names}}"
#   .\scripts\prod-remote.ps1 prod docker exec wms_prod_db psql -U postgres -d app -c "SELECT 1"
param(
    [Parameter(Position = 0)]
    [ValidateSet('prod', 'test')]
    [string] $Env = 'prod',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]] $RemoteCommand
)

$ErrorActionPreference = 'Stop'

if (-not $RemoteCommand -or $RemoteCommand.Count -eq 0) {
    Write-Error "Укажите команду: .\scripts\prod-remote.ps1 prod docker ps"
}

$sshHost = if ($Env -eq 'prod') { 'wms-prod' } else { 'wms-test' }
$remotePath = if ($Env -eq 'prod') { '/var/www/app-prod' } else { '/var/www/app-test' }
$cmd = ($RemoteCommand -join ' ').Trim()

& ssh $sshHost "cd $remotePath && $cmd"
