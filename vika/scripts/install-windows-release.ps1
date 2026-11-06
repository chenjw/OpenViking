# Reviewable release installer. No default download URL or published artifact is assumed.
[CmdletBinding(DefaultParameterSetName='Local')]
param(
    [Parameter(Mandatory, ParameterSetName='Local')][string]$Archive,
    [Parameter(Mandatory, ParameterSetName='Remote')][uri]$ArchiveUri,
    [Parameter(Mandatory)][string]$Sha256,
    [switch]$SkipSetup
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run on native Windows.' }
if (($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -notcontains 'AMD64') { throw 'This preview package targets Windows x64.' }
. (Join-Path $PSScriptRoot 'windows-release-common.ps1')
$base = Join-Path $env:USERPROFILE '.vika'
$current = Join-Path $base 'current'
$bin = Join-Path $base 'bin'
if (Test-Path -LiteralPath $current) { throw 'An installation exists. This installer does not replace or stop it.' }
foreach ($name in @('vika.cmd', 'vika-launch.mjs')) {
    if (Test-Path -LiteralPath (Join-Path $bin $name)) { throw 'An existing Vika launcher would be overwritten; installation refused.' }
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('vika-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$lockPath = Join-Path $base 'windows-release-install.lock'
[IO.Directory]::CreateDirectory($base) | Out-Null
try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
catch { Remove-Item -LiteralPath $temp -Recurse -Force; throw 'Another release install may be running; installation lock exists.' }
$installed = $false
$linkCreated = $false
$createdLaunchers = @()
$release = $null
try {
    if (Test-Path -LiteralPath $current) { throw 'Installation appeared while acquiring the lock.' }
    foreach ($name in @('vika.cmd', 'vika-launch.mjs')) {
        if (Test-Path -LiteralPath (Join-Path $bin $name)) { throw 'Launcher appeared while acquiring the lock.' }
    }
    $zip = Join-Path $temp 'release.zip'
    if ($PSCmdlet.ParameterSetName -eq 'Remote') {
        if ($ArchiveUri.Scheme -ne 'https') { throw 'Release downloads require HTTPS.' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUri -OutFile $zip
    } else { Copy-Item -LiteralPath $Archive -Destination $zip }
    Assert-VikaArchiveHash $zip $Sha256
    $stage = Join-Path $temp 'stage'
    Expand-VikaArchive $zip $stage
    $manifest = Assert-VikaRelease $stage
    # Only execute bytes after archive AND per-file verification. No npm at install time.
    $null = Assert-VikaReleaseBinaries $stage $manifest.node
    $release = Join-Path $base ('releases\windows-' + $manifest.version + '-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory((Split-Path $release -Parent)) | Out-Null
    Move-Item -LiteralPath $stage -Destination $release
    [IO.Directory]::CreateDirectory($bin) | Out-Null
    New-Item -ItemType Junction -Path $current -Target $release | Out-Null
    $linkCreated = $true
    $stream = [IO.File]::Open((Join-Path $bin 'vika-launch.mjs'), [IO.FileMode]::CreateNew)
    $createdLaunchers += 'vika-launch.mjs'
    try {
        $bytes = [IO.File]::ReadAllBytes((Join-Path $release 'scripts\windows-release-launch.mjs'))
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    $launcher = '@echo off' + "`r`n" + '"%~dp0..\current\node\node.exe" "%~dp0vika-launch.mjs" %*' + "`r`n"
    $stream = [IO.File]::Open((Join-Path $bin 'vika.cmd'), [IO.FileMode]::CreateNew)
    $createdLaunchers += 'vika.cmd'
    try {
        $bytes = [Text.Encoding]::ASCII.GetBytes($launcher)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    $installed = $true
    Write-Host 'Installed for the current user. PATH was not changed.'
    Write-Host 'Run: & "$env:USERPROFILE\.vika\bin\vika.cmd" setup'
    if (-not $SkipSetup) {
        & (Join-Path $current 'node\node.exe') (Join-Path $bin 'vika-launch.mjs') setup
        if ($LASTEXITCODE -ne 0) { throw 'Setup did not complete. Installation is retained; rerun the displayed setup command.' }
    }
} finally {
    if (-not $installed -and $release) {
        if ($linkCreated) { [IO.Directory]::Delete($current) }
        foreach ($name in $createdLaunchers) { Remove-Item -LiteralPath (Join-Path $bin $name) -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
    }
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath -Force
    Remove-Item -LiteralPath $temp -Recurse -Force
}
