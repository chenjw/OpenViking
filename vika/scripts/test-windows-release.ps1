# Credential-free fixture checks only. Does not build or install a release.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-release-common.ps1')
function Reject([scriptblock]$Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw 'Expected rejection did not occur.' }
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('vika-package-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    Assert-VikaLarkVersion 'lark-cli version v1.0.94' '1.0.94'
    Assert-VikaLarkVersion 'lark-cli version 1.0.94' '1.0.94'
    Reject { Assert-VikaLarkVersion 'help mentions 1.0.94' '1.0.94' }
    Reject { Assert-VikaLarkVersion 'lark-cli version 1.0.940' '1.0.94' }
    Reject { Assert-VikaLarkVersion 'lark-cli version 1.0.94-beta' '1.0.94' }
    foreach ($name in @('../escape', '/absolute', 'C:/absolute', 'a/../b', 'a:stream', 'CON.txt', 'a./b', 'a /b', 'a//b')) { Reject { Assert-VikaRelativePath $name } }
    if ((Assert-VikaRelativePath 'packages/cli/main.mjs') -ne 'packages/cli/main.mjs') { throw 'Valid path rejected.' }
    $zip = Join-Path $root 'traversal.zip'
    $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    $null = $archive.CreateEntry('../outside.txt')
    $archive.Dispose()
    Reject { Expand-VikaArchive $zip (Join-Path $root 'unpack') }
    if (Test-Path -LiteralPath (Join-Path $root 'outside.txt')) { throw 'Traversal escaped.' }
    Reject { Assert-VikaArchiveHash $zip ('0' * 64) }
    Assert-VikaArchiveHash $zip (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    $duplicate = Join-Path $root 'duplicate.zip'
    $archive = [IO.Compression.ZipFile]::Open($duplicate, [IO.Compression.ZipArchiveMode]::Create)
    $null = $archive.CreateEntry('A.txt'); $null = $archive.CreateEntry('a.txt'); $archive.Dispose()
    Reject { Expand-VikaArchive $duplicate (Join-Path $root 'duplicate') }
    $stage = Join-Path $root 'fixture'
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $required = @('node/node.exe','package.json','package-lock.json','permission.json','packages/cli/bin/vika.mjs','packages/daemon/scripts/check-pi.mjs','packages/daemon/scripts/check-durable.mjs','scripts/windows-release-launch.mjs','scripts/windows-launch.mjs','scripts/pm2-windows.cjs','node_modules/@larksuite/cli/bin/lark-cli.exe','node_modules/@larksuite/cli/package.json','packages/daemon/package.json','node_modules/@earendil-works/pi-coding-agent/package.json','node_modules/@earendil-works/pi-durable/package.json')
    $required += ([string][char]0x6587 + [char]0x6863 + "/readme.txt")
    $files = @()
    foreach ($name in $required) {
        $file = Join-Path $stage $name
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
        [IO.File]::WriteAllText($file, 'fixture; not executable')
        $files += @{ path=$name; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
    }
    $manifest = @{ schema=1; platform='win32-x64'; version='test-1'; node='24.21.0'; files=$files }
    $manifestFile = Join-Path $stage 'windows-release.json'
    [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    $null = Assert-VikaRelease $stage
    [IO.File]::WriteAllText((Join-Path $stage 'extra.txt'), 'unlisted')
    Reject { Assert-VikaRelease $stage }
    Remove-Item -LiteralPath (Join-Path $stage 'extra.txt')
    [IO.File]::AppendAllText((Join-Path $stage 'node/node.exe'), 'tampered')
    Reject { Assert-VikaRelease $stage }
    Write-Host 'Archive traversal, duplicate paths, hash mismatch, complete manifest and tampered file fixture checks passed.'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
