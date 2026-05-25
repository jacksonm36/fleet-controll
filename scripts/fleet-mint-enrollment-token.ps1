#!/usr/bin/env pwsh
<#
  Mint an enrollment pairing secret via Fleet API (operator JWT).

  Env (optional instead of flags):
    FLEET_API_URL (default http://127.0.0.1:4000)
    FLEET_OPERATOR_EMAIL
    FLEET_OPERATOR_PASSWORD   # discouraged in shared shells — prefer PSCredential stdin

  Example:
    $env:FLEET_OPERATOR_PASSWORD = Read-Host -AsSecureString | ... no
    .\scripts\fleet-mint-enrollment-token.ps1 -OperatorEmail admin@localhost -OperatorPasswordPlain 'changeme123'
    .\scripts\fleet-mint-enrollment-token.ps1 -OperatorEmail admin@localhost -RawTokenOnly
      # prompts for password securely
#>
param(
    [string] $ApiUrl = $(if ($env:FLEET_API_URL) { $env:FLEET_API_URL } else { 'http://127.0.0.1:4000' }),

    [string] $OperatorEmail = $env:FLEET_OPERATOR_EMAIL,

    [SecureString] $OperatorPassword,

    # Only for scripted dev — avoid in shared/hostile environments.
    [string] $OperatorPasswordPlain,

    [ValidateRange(5, 10080)]
    [int] $TtlMinutes = 120,

    # Print only the raw secret token (easy to pipe).
    [switch] $RawTokenOnly,

    # Skip Mint and supply the plaintext Fleet pairing secret (same value you paste into the Enrollment UI preview).
    [string] $UseExistingEnrollmentToken,

    # Convenience: read pairing secret from the environment instead of minting JWT (set FLEET_PAIRING_SECRET).
    [switch] $PreferEnvPairingSecret
)

$ErrorActionPreference = 'Stop'

function Strip-TrailingSlash([string]$s) {
    return ($s -replace '/+$', '')
}

$base = Strip-TrailingSlash $ApiUrl

$pairBypass = ''
if (-not [string]::IsNullOrWhiteSpace($UseExistingEnrollmentToken)) {
    $pairBypass = $UseExistingEnrollmentToken.Trim()
}
elseif ($PreferEnvPairingSecret -and $env:FLEET_PAIRING_SECRET) {
    $pairBypass = $env:FLEET_PAIRING_SECRET.Trim()
}
elseif ($env:FLEET_PAIRING_SECRET) {
    $pairBypass = $env:FLEET_PAIRING_SECRET.Trim()
}

if (-not [string]::IsNullOrWhiteSpace($pairBypass)) {
    $t = $pairBypass.Trim()
    if ($RawTokenOnly) { Write-Output $t; exit 0 }
    return @{
        Token        = $t
        MintedViaApi = $false
        ExpiresAt    = $null
    }
}

try {
    $null = Invoke-RestMethod -Method Get -Uri "$base/health" -TimeoutSec 10
}
catch {
    Write-Error "API not reachable at $base (${_}). Start the Fleet API then retry."
}

if (-not $OperatorEmail.Trim()) {
    Write-Error 'Provide -OperatorEmail or set $env:FLEET_OPERATOR_EMAIL.'
}

[string]$pwdPlain = $null
if ($OperatorPasswordPlain) {
    $pwdPlain = $OperatorPasswordPlain
} elseif ($null -ne $OperatorPassword) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($OperatorPassword)
    try {
        $pwdPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
} elseif ($env:FLEET_OPERATOR_PASSWORD) {
    Write-Warning 'Using FLEET_OPERATOR_PASSWORD from the environment.'
    $pwdPlain = $env:FLEET_OPERATOR_PASSWORD.Trim()
}

if (-not $pwdPlain -and [Environment]::UserInteractive -and (-not ([Console]::IsInputRedirected))) {
    Write-Host 'Enter operator password (same as Fleet web login).' -ForegroundColor Cyan
    $secPw = Read-Host -AsSecureString -Prompt 'Password'
    if ($null -ne $secPw) {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPw)
        try {
            $pwdPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
    }
}

if (-not $pwdPlain) {
    Write-Error @'
Missing operator password.

Set -OperatorPasswordPlain (dev only), -OperatorPassword ([SecureString]),
$env:FLEET_OPERATOR_PASSWORD, or rely on interactive Read-Host,

or bypass mint via -PreferEnvPairingSecret / -UseExistingEnrollmentToken / $env:FLEET_PAIRING_SECRET.
'@
}

$loginBody = @{ email = $OperatorEmail.Trim(); password = $pwdPlain } | ConvertTo-Json
try {
    $sess = Invoke-RestMethod `
        -Method Post `
        -Uri "$base/api/auth/login" `
        -ContentType 'application/json' `
        -Body $loginBody `
        -TimeoutSec 30
} catch {
    Write-Error "Login failed (${_}). Check email/password and API URL."
}

$jwt = $sess.token
if (-not $jwt) {
    Write-Error 'Login response missing token JWT.'
}

$hdr = @{ Authorization = "Bearer $jwt" }
$mintBody = @{ ttlMinutes = $TtlMinutes } | ConvertTo-Json
try {
    $mint = Invoke-RestMethod `
        -Method Post `
        -Uri "$base/api/enrollment-tokens" `
        -ContentType 'application/json' `
        -Headers $hdr `
        -Body $mintBody `
        -TimeoutSec 30
} catch {
    Write-Error "Mint enrollment token failed (${_}). Ensure the user is ADMIN/OPERATOR (not VIEWER)."
}

$pair = [string]$mint.token
if ([string]::IsNullOrWhiteSpace($pair)) {
    Write-Error 'Mint response missing token field.'
}

if ($RawTokenOnly) {
    Write-Output $pair
    exit 0
}

return @{
    Token        = $pair
    ExpiresAt    = $mint.expiresAt
    MintedViaApi = $true
}
