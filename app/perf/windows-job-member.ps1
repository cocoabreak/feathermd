param(
    [Parameter(Mandatory = $true)]
    [string]$JobName,
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
)

$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-job-host.cs')
if ([PerformanceJobHost]::IsMember($JobName, $ProcessId)) {
    Write-Output 'true'
} else {
    Write-Output 'false'
}
