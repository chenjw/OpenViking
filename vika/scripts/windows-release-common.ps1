# Shared by the opt-in Windows release builder, installer and fixture tests.
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-VikaArchiveHash([string]$Archive, [string]$Sha256) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'An independently obtained SHA-256 is required.' }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $Sha256) { throw 'Archive SHA-256 mismatch.' }
}

function Assert-VikaRelativePath([string]$Name) {
    $normalized = $Name.Replace('\', '/').TrimEnd('/')
    if (-not $normalized -or $normalized.StartsWith('/') -or $normalized.Contains(':')) { throw 'Unsafe archive path.' }
    foreach ($part in $normalized.Split('/')) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe archive path.' }
    }
    return $normalized
}

function Expand-VikaArchive([string]$Archive, [string]$Destination) {
    # Never extract directly into a live installation. Reject traversal, links,
    # Windows device names, duplicate case-insensitive paths and oversized input.
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 100000) { throw 'Archive contains too many entries.' }
        $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $name = Assert-VikaRelativePath $entry.FullName
            if (-not $names.Add($name)) { throw 'Duplicate archive path.' }
            $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ($unixType -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400)) { throw 'Archive links are not allowed.' }
            $total += $entry.Length
            if ($total -gt 4GB) { throw 'Archive exceeds the unpacked size limit.' }
        }
        New-Item -ItemType Directory -Path $Destination -ErrorAction Stop | Out-Null
        foreach ($entry in $zip.Entries) {
            $name = Assert-VikaRelativePath $entry.FullName
            $target = Join-Path $Destination $name
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
                [IO.Directory]::CreateDirectory($target) | Out-Null
            } else {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
                $inputStream = $entry.Open()
                $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            }
        }
    } finally { $zip.Dispose() }
}

function Assert-VikaRelease([string]$Root) {
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'windows-release.json') -Raw | ConvertFrom-Json
    if ($manifest.schema -ne 1 -or $manifest.platform -ne 'win32-x64' -or $manifest.version -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$') { throw 'Unsupported Windows release manifest.' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $manifest.files) {
        $name = Assert-VikaRelativePath $item.path
        if ($name -eq 'windows-release.json' -or -not $seen.Add($name)) { throw 'Duplicate or reserved manifest path.' }
        $file = Get-Item -LiteralPath (Join-Path $Root $name) -ErrorAction Stop
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Manifest requires regular files.' }
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ine $item.sha256 -or $item.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Release file SHA-256 mismatch.' }
    }
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release links are not allowed.' }
        if (-not $file.PSIsContainer) {
            $name = $file.FullName.Substring($Root.TrimEnd('\','/').Length + 1).Replace('\', '/')
            if ($name -ne 'windows-release.json' -and -not $seen.Contains($name)) { throw 'Unlisted release file.' }
        }
    }
    foreach ($required in @('node/node.exe', 'package.json', 'package-lock.json', 'packages/cli/bin/vika.mjs', 'packages/daemon/scripts/check-pi.mjs', 'packages/daemon/scripts/check-durable.mjs', 'scripts/windows-release-launch.mjs', 'scripts/windows-launch.mjs', 'scripts/pm2-windows.cjs', 'node_modules/@larksuite/cli/bin/lark-cli.exe', 'node_modules/@larksuite/cli/package.json', 'packages/daemon/package.json', 'node_modules/@earendil-works/pi-coding-agent/package.json', 'node_modules/@earendil-works/pi-durable/package.json')) {
        if (-not $seen.Contains($required)) { throw "Missing required release component: $required" }
    }
    return $manifest
}

function Assert-VikaReleaseBinaries([string]$Root, [string]$NodeVersion) {
    $node = Join-Path $Root 'node\node.exe'
    $sourcePin = (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).vika.node
    if ($NodeVersion -ne $sourcePin) { throw 'Manifest Node version differs from source pin.' }
    $actual = (& $node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -ne "v$NodeVersion") { throw 'Bundled Node version mismatch.' }
    $platform = (& $node -p 'process.platform.concat(String.fromCharCode(45),process.arch)').Trim()
    if ($LASTEXITCODE -ne 0 -or $platform -ne 'win32-x64') { throw 'Bundled Node platform mismatch.' }
    foreach ($script in @('check-pi.mjs', 'check-durable.mjs')) {
        & $node (Join-Path $Root "packages\daemon\scripts\$script")
        if ($LASTEXITCODE -ne 0) { throw "Bundled runtime validation failed: $script" }
    }
    $packageDir = Join-Path $Root 'node_modules\@larksuite\cli'
    $wanted = (Get-Content -LiteralPath (Join-Path $packageDir 'package.json') -Raw | ConvertFrom-Json).version
    $pinned = (Get-Content -LiteralPath (Join-Path $Root 'packages\daemon\package.json') -Raw | ConvertFrom-Json).dependencies.'@larksuite/cli'
    if ($wanted -ne $pinned) { throw 'Bundled Lark package differs from the daemon pin.' }
    $larkVersion = & (Join-Path $packageDir 'bin\lark-cli.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Lark CLI could not execute.' }
    Assert-VikaLarkVersion ($larkVersion -join "`n") $wanted
}

function Assert-VikaLarkVersion([string]$Output, [string]$Expected) {
    if ($Expected -notmatch '^\d+\.\d+\.\d+(?:-[\w.-]+)?$') { throw 'Invalid Lark package version.' }
    $match = [regex]::Match($Output.Trim(), '^lark-cli version v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)', [Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $match.Success -or $match.Groups[1].Value -cne $Expected) { throw 'Bundled Lark CLI version mismatch.' }
}
