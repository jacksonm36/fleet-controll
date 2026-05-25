#!/usr/bin/env pwsh
<#
  One-shot: ensure a second WSL distro exists (Ubuntu-24.04 by default),
  bootstrap build deps as root (no interactive sudo), install fleet-agent, and optionally
  mint pairing secret (−AutoFleetBootstrap), enroll in WSL, and install systemd/cron autostart.

  Env: set FLEET_AUTO_WSL_BOOTSTRAP=1 instead of −AutoFleetBootstrap.

  Examples:
      .\scripts\setup-second-wsl-fleet-agent.ps1 -WindowsRepoRoot 'D:\manager'

      .\scripts\setup-second-wsl-fleet-agent.ps1 -AutoFleetBootstrap -FleetOperatorEmail admin@localhost

      .\scripts\setup-second-wsl-fleet-agent.ps1 -FleetPairingSecret '<from UI mint>' -AutoFleetBootstrap
#>
param(
    [string] $WindowsRepoRoot,

    [string] $Distro = 'Ubuntu-24.04',

    [switch] $SkipDistroInstall,

    # Do not elevate to run wsl --install when the distro is missing (print instructions instead).
    [switch] $NoElevatedDistroInstall,

    # After build: ping API, optionally mint pairing secret, enroll agent in WSL, install autostart unit/cron.
    [switch] $AutoFleetBootstrap,

    # Fleet API URL as seen from THIS Windows machine (mint/login and health ping).
    [string] $FleetApiUrl,

    # Base URL fleet-agent should use INSIDE WSL ($null = localhost:4000 unless -DiscoverFleetCentralFromWsl).
    [string] $FleetAgentCentralUrl,

    # Prefer nameserver-derived host (fleet-central-url-wsl.sh) over 127.0.0.1.
    [switch] $DiscoverFleetCentralFromWsl,

    [string] $FleetOperatorEmail = $env:FLEET_OPERATOR_EMAIL,

    # Dev/scripted only — avoid in shared consoles.
    [string] $FleetOperatorPasswordPlain = $env:FLEET_OPERATOR_PASSWORD,

    # Skip API mint — use UI-minted or pre-shared pairing secret instead of JWT mint.
    [string] $FleetPairingSecret = $env:FLEET_PAIRING_SECRET,

    [switch] $FleetSkipEnrollment,

    [switch] $FleetSkipAutostart
)

$ErrorActionPreference = 'Stop'
$ScriptsDir = Split-Path -Parent $PSCommandPath

if (-not $WindowsRepoRoot) {
    $WindowsRepoRoot = (Resolve-Path (Join-Path $ScriptsDir '..')).Path
}

function Get-WslDistributionNames {
    $lxss = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    if (-not (Test-Path $lxss)) { return @() }
    Get-ChildItem $lxss -ErrorAction SilentlyContinue | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        $n = $p.DistributionName
        if ($null -ne $n -and $n -ne '') { [string]$n }
    }
}

function Test-WslDistroRegistered([string]$Name) {
    $names = @(Get-WslDistributionNames | Select-Object -Unique)
    return $names -contains $Name
}

function To-WslUnixPath([string]$WinPath) {
    $drive = ([string]$WinPath[0]).ToLowerInvariant()
    $tail = $WinPath.Substring(2).Replace('\', '/')
    return "/mnt/$drive$tail"
}

# Wrap for safe single-quoted use in bash (-lc "...").
function BashSQ([string]$Inner) {
    $Inner = [string]$Inner
    $aq = "'"
    $rep = $aq + '\' + $aq + $aq
    return $aq + $Inner.Replace($aq, $rep) + $aq
}

function Normalize-ApiBase([string]$u) {
    $t = ($u ?? '').Trim().TrimEnd('/')
    return $t
}

$unixRepo = To-WslUnixPath $WindowsRepoRoot
$crlfScripts = @(
    "$unixRepo/scripts/rust-agent-setup-wsl.sh"
    "$unixRepo/scripts/rust-agent-apt-root.sh"
    "$unixRepo/scripts/fleet-central-url-wsl.sh"
    "$unixRepo/scripts/fleet-agent-curl-enroll.sh"
    "$unixRepo/scripts/wsl-fleet-agent-autostart.sh"
    "$unixRepo/scripts/wsl-api-mint-enrollment-token.sh"
)
$crlfFix = (($crlfScripts | ForEach-Object { "sed -i 's/\r$//' '$_' 2>/dev/null || true" }) -join '; ')

$registered = Test-WslDistroRegistered $Distro
if (-not $registered) {
    Write-Host "WSL distro '$Distro' is not registered yet."
    if ($SkipDistroInstall) {
        Write-Error "Pass -SkipDistroInstall only when '$Distro' already exists."
        exit 2
    }
    if ($NoElevatedDistroInstall) {
        Write-Host @"

Install manually (elevated PowerShell):

    wsl --install -d $Distro

Then re-run:

    $($MyInvocation.ScriptName.Replace($HOME, '~'))

"@
        exit 3
    }
    Write-Host "Launching installer (accept UAC if prompted) ..."
    Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install', '-d', $Distro) -Verb RunAs -Wait
    $deadline = [DateTime]::UtcNow.AddMinutes(45)
    while (-not (Test-WslDistroRegistered $Distro)) {
        if ([DateTime]::UtcNow -gt $deadline) {
            Write-Error "Timeout waiting for '$Distro' to appear in WSL registry."
            exit 4
        }
        Start-Sleep -Seconds 3
    }
}

Write-Host 'Waiting for distro to accept commands ...'
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
    $null = & wsl.exe -d $Distro -e bash -lc 'exit 0' 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 5
}

if (-not $ready) {
    Write-Host "First-time setup may need you to finish Ubuntu user creation. Open:"
    Write-Host "  wsl -d $Distro"
    Write-Host "Then re-run this script."
    exit 5
}

$aptRootUnix = "$unixRepo/scripts/rust-agent-apt-root.sh"
Write-Host "Installing build toolchain as root inside $Distro ..."
$bootApt = "$crlfFix; bash '$aptRootUnix'"
$r = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $Distro, '-u', 'root', '--', 'bash', '-lc', $bootApt) -Wait -PassThru -NoNewWindow
if ($r.ExitCode -ne 0) {
    Write-Error "Root apt bootstrap failed (exit $($r.ExitCode)). Try manually: wsl -d $Distro -u root"
    exit $r.ExitCode
}

Write-Host "Building and installing fleet-agent (user context) ..."
$installPs1 = Join-Path $ScriptsDir 'install-rust-agent-second-wsl.ps1'

& pwsh.exe -NoProfile -File $installPs1 -WindowsRepoRoot $WindowsRepoRoot -Distro $Distro -SkipSystemDeps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
$doBootstrap = $AutoFleetBootstrap -or ($env:FLEET_AUTO_WSL_BOOTSTRAP -eq '1')
if (-not $doBootstrap) {
    Write-Host "Done ($Distro). Manual Fleet hookup:"
    Write-Host "  bash $unixRepo/scripts/fleet-central-url-wsl.sh   # suggested URL toward Windows-hosted API"
    Write-Host '  export FLEET_CENTRAL_URL=http://127.0.0.1:4000'
    Write-Host "  pairing secret → env FLEET_ENROLL_TOKEN (one-time)"
    Write-Host '  ~/.local/bin/fleet-agent'
    Write-Host 'Or rerun with -AutoFleetBootstrap (mint + enroll + autostart).'
    exit 0
}

if ($FleetSkipEnrollment -and $FleetSkipAutostart) {
    Write-Warning '-FleetSkipEnrollment and -FleetSkipAutostart leaves nothing automated.'
    exit 0
}

if (-not $FleetApiUrl -or [string]::IsNullOrWhiteSpace($FleetApiUrl)) {
    if ($env:FLEET_API_URL -and (-not [string]::IsNullOrWhiteSpace($env:FLEET_API_URL))) {
        $FleetApiUrl = $env:FLEET_API_URL.Trim()
    }
    else {
        $FleetApiUrl = 'http://127.0.0.1:4000'
    }
}
$fapiWin = Normalize-ApiBase $FleetApiUrl

$centralOverride = ''
if ($null -ne $FleetAgentCentralUrl -and (-not [string]::IsNullOrWhiteSpace(([string]$FleetAgentCentralUrl).Trim()))) {
    $centralOverride = Normalize-ApiBase(([string]$FleetAgentCentralUrl).Trim())
}

if ($DiscoverFleetCentralFromWsl) {
    $probeInner = "$crlfFix; bash '$unixRepo/scripts/fleet-central-url-wsl.sh'"
    $picked = (& wsl.exe -d $Distro -- bash -lc $probeInner 2>&1 | ForEach-Object { "$_" } |
        Where-Object { $_ -match '\S' } |
        Select-Object -Last 1)
    $centralResolved = if ($picked) { Normalize-ApiBase ($picked.Trim()) } else { 'http://127.0.0.1:4000' }
}
elseif (-not [string]::IsNullOrWhiteSpace($centralOverride)) {
    $centralResolved = $centralOverride
}
else {
    $centralResolved = 'http://127.0.0.1:4000'
}

Write-Host 'AutoFleet bootstrap: central (from WSL) =' $centralResolved 'API/mint =' $fapiWin

$mintScript = Join-Path $ScriptsDir 'fleet-mint-enrollment-token.ps1'
$tmpPairPath = ''

try {
    $pairPlain = [string]::Empty
    if (-not $FleetSkipEnrollment) {
        if ((-not [string]::IsNullOrWhiteSpace(([string]$FleetPairingSecret).Trim()))) {
            $pairPlain = ([string]$FleetPairingSecret).Trim()
        }

        if ([string]::IsNullOrWhiteSpace($pairPlain)) {
            try {
                $null = Invoke-RestMethod -Method Get -Uri "$fapiWin/health" -TimeoutSec 15
            }
            catch {
                Write-Error "Fleet API unreachable at ${fapiWin} (${_}). Start the stack or set -FleetApiUrl."
                exit 6
            }

            if (-not $FleetOperatorEmail -or $FleetOperatorEmail.Trim().Length -eq 0) {
                Write-Error 'Enrollment needs -FleetPairingSecret or (-FleetOperatorEmail for API mint via fleet-mint-enrollment-token.ps1).'
                exit 7
            }

            Write-Host 'Minting pairing secret from API (JWT login)...'
            $mintArgs = @(
                '-NoProfile', '-File', $mintScript,
                '-ApiUrl', $fapiWin,
                '-RawTokenOnly',
                '-OperatorEmail', ($FleetOperatorEmail.Trim())
            )
            if (-not [string]::IsNullOrWhiteSpace($FleetOperatorPasswordPlain)) {
                $mintArgs += @('-OperatorPasswordPlain', ($FleetOperatorPasswordPlain.Trim()))
            }

            $pairPlain = @( & pwsh.exe @mintArgs )

            # RawTokenOnly may emit multiple stdout lines — take last non-whitespace token line
            $pairPlain = @( $pairPlain | Where-Object { $null -ne $_ -and $_.Trim() -ne '' } | Select-Object -Last 1 ) -join ''
            $pairPlain = $pairPlain.Trim()
        }

        if ([string]::IsNullOrWhiteSpace($pairPlain)) {
            Write-Error 'Mint returned an empty pairing secret.'
            exit 8
        }

        $tmpPairPath = [IO.Path]::Combine([IO.Path]::GetTempPath(), "fleet-bootstrap-$([guid]::NewGuid().ToString('n')).secret")
        $utf8nb = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($tmpPairPath, $pairPlain, $utf8nb)

        if (-not (Test-Path $tmpPairPath)) {
            Write-Error 'Unable to persist temporary pairing secret for WSL enrollment.'
            exit 9
        }
    }

    $innerParts = New-Object System.Collections.Generic.List[string]
    $innerParts.Add($crlfFix)

    $enrollAbs = BashSQ("$unixRepo/scripts/fleet-agent-curl-enroll.sh")
    $autoAbs = BashSQ("$unixRepo/scripts/wsl-fleet-agent-autostart.sh")
    $innerParts.Add(("chmod +x {0} {1}" -f $enrollAbs, $autoAbs))

    if ((-not $FleetSkipEnrollment) -or (-not $FleetSkipAutostart)) {
        $innerParts.Add("export FLEET_CENTRAL_URL=$(BashSQ $centralResolved)")
    }

    if (-not $FleetSkipEnrollment) {
        $unixSecret = BashSQ($(To-WslUnixPath($tmpPairPath)))
        $innerParts.Add(("bash {0} --secret-file {1}" -f $enrollAbs, $unixSecret))
    }

    if (-not $FleetSkipAutostart) {
        $innerParts.Add(("bash {0}" -f $autoAbs))
    }

    $innerCombined = (($innerParts | Where-Object { $null -ne $_ -and $_.Trim() -ne '' }) -join '; ')

    Write-Host "Running Fleet bootstrap inside WSL distro $Distro ..."
    & wsl.exe -d $Distro -- bash -lc $innerCombined
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fleet bootstrap inside WSL failed (exit=$LASTEXITCODE)."
        exit $LASTEXITCODE
    }

    Write-Host ''
    Write-Host "Done ($Distro). Enrollment + autostart should be wired (see systemd --user fleet-agent.service or cron @reboot)."
    Write-Host "Logs when using cron/no-journal fallback: ~/.local/share/fleet-agent/agent.log"
}
finally {
    if ($tmpPairPath -and (Test-Path -LiteralPath $tmpPairPath)) {
        Remove-Item -LiteralPath $tmpPairPath -Force -ErrorAction SilentlyContinue
    }
}
