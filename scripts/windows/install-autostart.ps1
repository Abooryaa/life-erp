# Registers a Windows scheduled task that starts LIFE ERP when you log in.
# Run once from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
# Remove it again:           Unregister-ScheduledTask -TaskName "LIFE ERP" -Confirm:$false

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$cmd = Join-Path $repo 'scripts\windows\start-life-erp.cmd'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'LIFE ERP' -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the LIFE ERP server at logon' -Force | Out-Null
Write-Host "Done. LIFE ERP will start automatically when $env:USERNAME logs in."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName 'LIFE ERP'"
