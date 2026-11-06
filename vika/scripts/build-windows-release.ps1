# Maintainer-only packaging source. Running this builds an artifact, never publishes it.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$NodeArchive,
    [Parameter(Mandatory)][string]$NodeSha256,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$Ref = 'HEAD'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Build on native Windows x64.' }
if ($Version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Invalid release version.' }
. (Join-Path $PSScriptRoot 'windows-release-common.ps1')
$NodeArchive = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($NodeArchive)
$OutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$source = Split-Path $PSScriptRoot -Parent
$repo = (& git -C $source rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Not a Git checkout.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('vika-build-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
$oldPath = $env:PATH
try {
    # Archive only committed allowlisted application paths, never the checkout,
    # artifacts, credentials, local configuration, caches or a host node_modules.
    $sourceZip = Join-Path $temp 'source.zip'
    $commit = (& git -C $source rev-parse --verify "$Ref^{commit}").Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid committed source ref.' }
    & git -C $repo archive --format=zip "--output=$sourceZip" "${commit}:vika" package.json package-lock.json permission.json deployment-config.cjs ecosystem.config.cjs packages/cli packages/daemon packages/web packages/updater LICENSE THIRD_PARTY_NOTICES.md scripts/pm2-windows.cjs scripts/windows-launch.mjs scripts/windows-release-launch.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Source archive failed; commit the release scripts before building.' }
    $stage = Join-Path $temp 'stage'
    Expand-VikaArchive $sourceZip $stage
    Assert-VikaArchiveHash $NodeArchive $NodeSha256
    $nodeStage = Join-Path $temp 'node-unpack'
    Expand-VikaArchive $NodeArchive $nodeStage
    $nodeRoots = @(Get-ChildItem -LiteralPath $nodeStage -Directory)
    if ($nodeRoots.Count -ne 1) { throw 'Expected the official Node Windows ZIP layout.' }
    Move-Item -LiteralPath $nodeRoots[0].FullName -Destination (Join-Path $stage 'node')
    $node = Join-Path $stage 'node\node.exe'
    $wantedNode = (Get-Content -LiteralPath (Join-Path $stage 'package.json') -Raw | ConvertFrom-Json).vika.node
    $actualNode = (& $node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualNode -ne "v$wantedNode") { throw 'Node version differs from the source pin.' }
    $architecture = (& $node -p 'process.platform.concat(String.fromCharCode(45),process.arch)').Trim()
    if ($LASTEXITCODE -ne 0 -or $architecture -ne 'win32-x64') { throw 'Node platform mismatch.' }
    $env:PATH = (Join-Path $stage 'node') + ';' + $oldPath
    Push-Location $stage
    try {
        & $node (Join-Path $stage 'node\node_modules\npm\bin\npm-cli.js') ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Native dependency installation failed.' }
        $larkPackage = Join-Path $stage 'node_modules\@larksuite\cli'
        if (-not (Test-Path -LiteralPath (Join-Path $larkPackage 'bin\lark-cli.exe'))) {
            # npm versions that suppress third-party lifecycle scripts need this
            # explicit locked installer; its own integrity checks remain active.
            $oldLarkRun = $env:LARK_CLI_RUN
            try {
                $env:LARK_CLI_RUN = '1'
                & $node (Join-Path $larkPackage 'scripts\install.js')
                if ($LASTEXITCODE -ne 0) { throw 'Pinned Lark binary installation failed.' }
            } finally { $env:LARK_CLI_RUN = $oldLarkRun }
        }
        & $node packages/daemon/scripts/check-pi.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Pi validation failed.' }
        & $node packages/daemon/scripts/check-durable.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Durable validation failed.' }
    } finally { Pop-Location }
    $null = Assert-VikaReleaseBinaries $stage $wantedNode
    # npm workspace junctions must become ordinary directory copies in the ZIP.
    foreach ($name in @('cli','daemon','web','updater')) {
        $link = Join-Path $stage "node_modules\@vika\$name"
        if (Test-Path -LiteralPath $link) {
            $item = Get-Item -LiteralPath $link -Force
            if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected workspace dependency layout.' }
            [IO.Directory]::Delete($link)
            Copy-Item -LiteralPath (Join-Path $stage "packages\$name") -Destination $link -Recurse
        }
    }
    $files = @()
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -Force) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unresolved dependency link cannot be packaged.' }
        if (-not $file.PSIsContainer) {
            $relative = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
            $null = Assert-VikaRelativePath $relative
            $files += @{ path=$relative; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
    }
    $manifest = @{ schema=1; version=$Version; platform='win32-x64'; commit=$commit; node=$wantedNode; files=$files }
    [IO.File]::WriteAllText((Join-Path $stage 'windows-release.json'), ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    $null = Assert-VikaRelease $stage
    [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
    $output = Join-Path $OutputDirectory "vika-$Version-win32-x64.zip"
    if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath "$output.sha256")) { throw 'Output already exists; refusing to overwrite.' }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $output, [IO.Compression.CompressionLevel]::Optimal, $false)
    $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))`n")
    Write-Host "Artifact prepared: $output"
    Write-Host 'Not published. Maintainers must verify and distribute the archive hash through a trusted channel.'
} finally {
    $env:PATH = $oldPath
    Remove-Item -LiteralPath $temp -Recurse -Force
}
