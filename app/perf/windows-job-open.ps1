param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][string]$JobName,
  [Parameter(Mandatory = $true)][string]$OwnedRunDirectory,
  [Parameter(Mandatory = $true)][string]$FixturePath,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][long]$ExpectedByteSize
)

$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-job-host.cs')
$lease = [PerformanceJobHost]::OpenFixtureAndHold(
  $Executable,
  $WorkingDirectory,
  $JobName,
  $OwnedRunDirectory,
  $FixturePath,
  $ExpectedSha256,
  $ExpectedByteSize)
try {
  Write-Output '{"opened":true}'
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
} finally {
  $lease.Dispose()
}
