#!/usr/bin/env pwsh
<#
Install / build fleet-agent inside another WSL distribution (recommended: Ubuntu alongside Debian).

Requirements:
  - Repo on Windows under /mnt/<letter>/...

Examples:
    # Auto-pick Ubuntu* from registry or second distro when two exist:
    .\scripts\install-rust-agent-second-wsl.ps1 -WindowsRepoRoot 'D:\manager'

    # Only Debian registered — smoke install without apt (toolchain must exist):
    .\scripts\install-rust-agent-second-wsl.ps1 -Distro 'Debian' -AllowSingleDistro -SkipSystemDeps
#>
param(
    [Parameter(Mandatory = $false)]
    [string] $Distro = $env:FLEET_SECONDARY_WSL_DISTRO,

    [string] $WindowsRepoRoot,

    [switch] $AllowSingleDistro,

    [switch] $SkipSystemDeps
)

$ErrorActionPreference = "Stop"
$ScriptsDir = Split-Path -Parent $PSCommandPath

if (-not $WindowsRepoRoot) {
    $WindowsRepoRoot = Resolve-Path (Join-Path $ScriptsDir "..") | Select-Object -ExpandProperty Path
}

function Get-WslDistributionNames {
    $lxss = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    if (-not (Test-Path $lxss)) { return @() }
    Get-ChildItem $lxss -ErrorAction SilentlyContinue | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        $n = $p.DistributionName
        if ($null -ne $n -and $n -ne "") { [string]$n }
    }
}

function To-WslUnixPath([string]$WinPath) {
    $drive = ([string]$WinPath[0]).ToLowerInvariant()
    $tail = $WinPath.Substring(2).Replace('\', '/')
    return "/mnt/$drive$tail"
}

$resolvedDistro = $Distro.Trim()
$list = @(Get-WslDistributionNames | Select-Object -Unique)

if (-not $resolvedDistro) {
    $ubuntuish = @($list | Where-Object { $_ -like 'Ubuntu*' } | Select-Object -First 1)
    if ($ubuntuish.Count -ge 1) {
        $resolvedDistro = $ubuntuish[0]
    }
    elseif ($list.Count -ge 2) {
        $resolvedDistro = $list[1]
    }
    elseif ($list.Count -eq 1 -and $AllowSingleDistro) {
        Write-Warning "Only one distro registered ($($list[0])). Using -AllowSingleDistro."
        $resolvedDistro = $list[0]
    }
    else {
        Write-Error @"
No usable secondary WSL distro found (registry shows $($list.Count) total).

Install another (elevated PowerShell once):
    wsl --install -d Ubuntu-24.04

Then rerun and pass `-Distro 'Ubuntu-24.04'` or set:
    `$env:FLEET_SECONDARY_WSL_DISTRO = 'Ubuntu-24.04'

Smoke-test on your only distro (not isolation):
    ... -Distro '$($list[0])' -AllowSingleDistro
"@
        exit 2
    }
}

$unixRepo = To-WslUnixPath $WindowsRepoRoot
$setupUnix = "$unixRepo/scripts/rust-agent-setup-wsl.sh"

Write-Host "Distro       : $resolvedDistro"
Write-Host "Repo (Win)   : $WindowsRepoRoot"
Write-Host "Repo (POSIX) : $unixRepo"

$crlfFix = "sed -i 's/\r$//' '$unixRepo/scripts/rust-agent-setup-wsl.sh' 2>/dev/null || true; sed -i 's/\r$//' '$unixRepo/scripts/rust-agent-apt-root.sh' 2>/dev/null || true; sed -i 's/\r$//' '$unixRepo/scripts/fleet-central-url-wsl.sh' 2>/dev/null || true; sed -i 's/\r$//' '$unixRepo/scripts/fleet-agent-curl-enroll.sh' 2>/dev/null || true; sed -i 's/\r$//' '$unixRepo/scripts/wsl-fleet-agent-autostart.sh' 2>/dev/null || true; sed -i 's/\r$//' '$unixRepo/scripts/wsl-api-mint-enrollment-token.sh' 2>/dev/null || true"

$prepend = ""
if ($SkipSystemDeps -or ($env:SKIP_SYSTEM_DEPS -eq "1")) {
    $prepend = "export SKIP_SYSTEM_DEPS=1; "
}

$fleetRepoExport = "export FLEET_REPO='$unixRepo'"
$inner = "$crlfFix; $prepend$fleetRepoExport; bash '$setupUnix'"

& wsl.exe -d $resolvedDistro -- bash -lc $inner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Installed:`$HOME/.local/bin/fleet-agent (inside distro $resolvedDistro)"
Write-Host "Suggest central URL:"
Write-Host "  bash $unixRepo/scripts/fleet-central-url-wsl.sh"
Write-Host "(Also try http://127.0.0.1:4000 from WSL when the API listens on Windows with mirrored localhost.)"
Write-Host ""
Write-Host "In that distro shell: add PATH (~/.local/bin), set FLEET_CENTRAL_URL + FLEET_ENROLL_TOKEN, run fleet-agent (see rust-agent/README.md)."
