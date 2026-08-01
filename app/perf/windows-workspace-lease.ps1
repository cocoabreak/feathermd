param(
  [Parameter(Mandatory = $true)][string]$RunDirectory,
  [Parameter(Mandatory = $true)][string]$ProfileDirectory,
  [Parameter(Mandatory = $true)][string]$AppDataDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-job-host.cs')
$lease = [PerformanceJobHost]::OpenWorkspaceAndHold(
  $RunDirectory,
  $ProfileDirectory,
  $AppDataDirectory)
try {
  Write-Output '{"leased":true}'
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
} finally {
  $lease.Dispose()
}
