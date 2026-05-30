#!/usr/bin/env pwsh
<#
  Build fleet-agent.exe for native Windows (amd64).

  Requires Go: https://go.dev/dl/

  Example (from repo root on Windows):
    .\scripts\build-fleet-agent-windows.ps1
    .\agent\fleet-agent.exe -central https://YOUR_CONTROLLER -enroll-token YOUR_SECRET
#>
param(
    [string] $Version = $(if ($env:FLEET_AGENT_VERSION) { $env:FLEET_AGENT_VERSION } else { '0.4.0' }),
    [ValidateSet('amd64', 'arm64')]
    [string] $Arch = 'amd64'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AgentDir = Join-Path $Root 'agent'
$Out = Join-Path $AgentDir 'fleet-agent.exe'

$ldflags = "-s -w -X main.AgentVersion=$Version"
Push-Location $AgentDir
try {
    $env:GOOS = 'windows'
    $env:GOARCH = $Arch
    go build -ldflags $ldflags -o $Out ./cmd/agent
} finally {
    Pop-Location
}

Write-Host "Built: $Out"
Write-Host "Enroll once: `$env:FLEET_CENTRAL_URL='https://YOUR_CONTROLLER'; `$env:FLEET_ENROLL_TOKEN='minted-secret'; & '$Out'"
