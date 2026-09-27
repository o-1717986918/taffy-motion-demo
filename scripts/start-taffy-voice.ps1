param(
  [string]$VCClientExe = $env:TAFFY_VCCLIENT_EXE,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$vcRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $VCClientExe))
$startedVCClient = $false

if ([string]::IsNullOrWhiteSpace($VCClientExe)) {
  throw "Set TAFFY_VCCLIENT_EXE to the path of your local VCClient main.exe."
}

function Test-LocalPort([int]$Port) {
  return $null -ne (Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-LocalPort([int]$Port, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Test-VCClientApi {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:18888/api/voice-changer-manager/information" -Method Get -TimeoutSec 4
    return $null -ne $status.voice_changer_information
  } catch {
    return $false
  }
}

function Wait-VCClientApi([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-VCClientApi) { return $true }
    Start-Sleep -Milliseconds 750
  }
  return $false
}

function Stop-StaleVCClient {
  $expectedExe = [IO.Path]::GetFullPath($VCClientExe)
  $vcProcesses = Get-CimInstance Win32_Process -Filter "Name = 'main.exe'" |
    Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($expectedExe, [StringComparison]::OrdinalIgnoreCase) }
  if (!$vcProcesses) {
    throw "Port 18888 is occupied, but its owner is not $VCClientExe"
  }
  $vcProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-Process -Name "voice-changer-native-client" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and (Test-LocalPort 18888)) { Start-Sleep -Milliseconds 250 }
  if (Test-LocalPort 18888) { throw "The stale VCClient process did not release port 18888." }
}

if (!(Test-Path -LiteralPath $VCClientExe -PathType Leaf)) {
  throw "VCClient not found: $VCClientExe"
}

if ((Test-LocalPort 18888) -and !(Test-VCClientApi)) {
  Write-Host "VCClient port is open but its API is unresponsive. Restarting the stale process..."
  Stop-StaleVCClient
}

if (!(Test-LocalPort 18888)) {
  $vcWorkingDirectory = Split-Path -Parent $VCClientExe
  $vcStdout = Join-Path $vcRoot "vcclient.stdout.log"
  $vcStderr = Join-Path $vcRoot "vcclient.stderr.log"
  $vcArgs = @(
    "cui", "--host=127.0.0.1", "--port=18888",
    "--https=False", "--launch_client=False", "--no_cui=True"
  )
  Start-Process -FilePath $VCClientExe -ArgumentList $vcArgs -WorkingDirectory $vcWorkingDirectory `
    -WindowStyle Hidden -RedirectStandardOutput $vcStdout -RedirectStandardError $vcStderr | Out-Null
  $startedVCClient = $true
  if (!(Wait-LocalPort 18888 90)) {
    throw "VCClient did not open 127.0.0.1:18888. See $vcStderr"
  }
  if (!(Wait-VCClientApi 90)) {
    throw "VCClient opened port 18888 but its HTTP API did not become ready. See $vcStderr"
  }
}

if (!(Test-LocalPort 5173)) {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $webStdout = Join-Path $projectRoot "taffy-web.stdout.log"
  $webStderr = Join-Path $projectRoot "taffy-web.stderr.log"
  Start-Process -FilePath $npm -ArgumentList @("run", "dev") -WorkingDirectory $projectRoot `
    -WindowStyle Hidden -RedirectStandardOutput $webStdout -RedirectStandardError $webStderr | Out-Null
  if (!(Wait-LocalPort 5173 30)) {
    throw "Web demo did not open 127.0.0.1:5173. See $webStderr"
  }
}

# VCClient 2.0.78 still launches a native companion even with launch_client=false.
# That process owns the lifetime signal for main.exe: terminating it also shuts down
# the localhost API a few seconds later, so it must remain alive with the backend.

$health = Invoke-RestMethod -Uri "http://127.0.0.1:18888/api/voice-changer-manager/information" -Method Get -TimeoutSec 10
Write-Host "VCClient ready. Active=$($health.local_voice_changer_interface_active)"
if (!$NoBrowser) {
  Write-Host "Opening http://127.0.0.1:5173/"
  Start-Process "http://127.0.0.1:5173/"
}
