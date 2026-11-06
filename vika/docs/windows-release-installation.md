# Windows release installation: implementation for review

This adds a separate **Windows x64 release ZIP format and installer**. It does
not change the macOS/Linux installer or the Windows source installer. No release
has been built, installed, or published as part of this change. There is no
promised public download URL. A maintainer must build, test and distribute an
artifact and its trusted checksum before users can use this path.

## User flow once a verified artifact is available

With the reviewed `install-windows-release.ps1` and
`windows-release-common.ps1` together in a trusted directory, one invocation is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows-release.ps1 -Archive .\vika-VERSION-win32-x64.zip -Sha256 TRUSTED_64_HEX_SHA256
```

`-ArchiveUri` accepts a maintainer-supplied HTTPS URL instead of `-Archive`.
Obtain the expected hash through a trusted release channel, not by trusting an
unverified archive's own manifest. HTTPS/hash verification does not replace
trust in the installer or publisher. The helper is part of the reviewed installer
source; this is not yet a hosted download-and-execute bootstrap.

No system Node, npm, Git, administrator privileges or PATH change is required.
The ZIP contains pinned Node, Windows-installed `node_modules`, Pi, Durable,
PM2, Lark CLI and the application. Installation verifies the archive hash,
rejects unsafe ZIP entries, checks a complete per-file SHA-256 manifest, then
checks the actual Node platform/version, Pi version, Durable host handshake,
and Lark CLI version. Nothing is downloaded to repair dependencies at install
time. An incomplete bundle fails before activation.

The installer activates a new directory under `%USERPROFILE%\.vika\releases`
with a `current` junction and writes `%USERPROFILE%\.vika\bin\vika.cmd`. It
refuses to overwrite an existing installation or launcher, does not stop any
service and does not enable autostart. Use the full launcher path because PATH
is unchanged. Setup starts by default; `-SkipSetup` is available for inspection.
If setup fails or is cancelled, the verified installation remains for retry:

```powershell
& "$env:USERPROFILE\.vika\bin\vika.cmd" setup
```

## Models, secrets and OpenViking

The release bootstrap preserves the real user's home and existing Pi settings,
including configured Pi directories, and forwards existing
`VIKA_SECRETS_FILE` and `OPENVIKING_CLI_CONFIG_FILE`. It never copies credentials
into the release, prints their contents, or introduces a second secrets parser.
Existing Vika secrets handling remains responsible for provider keys.

Setup already offers built-in Pi `/login` and `/quit` when no usable runtime is
found on an interactive terminal. Custom model providers still use the existing
Pi configuration workflow. At the reviewed baseline, Durable detection reads
Vika's secrets file; Pi's model-list probe uses its inherited environment and Pi
state. This installer does **not** claim to fix that detection difference or to
make a secrets-file-only Pi configuration automatically selectable.

Setup discovers existing OV configuration and guides configuration when needed.
A reachable OpenViking server and appropriate credentials are still required;
the bundle does not install the Python/native OV server. A clean machine cannot
complete the whole workflow with only a Feishu App ID and secret: model access,
OV configuration, and messaging authorization may also be needed.

## Maintainer packaging source (do not run as an install step)

`build-windows-release.ps1` requires native Windows x64, a committed source ref,
and an official Windows Node ZIP with an independently verified checksum. It
checks the actual Node version against `package.json`'s pin. It archives an
explicit allowlist of committed Vika application paths; checkout artifacts,
untracked files, host dependencies and user credentials are not copied.
Dependencies are installed natively with the bundled Node/npm, including an
explicit locked Lark installer when lifecycle execution did not supply its
binary. Known npm workspace junctions are materialized; remaining links fail.
The builder writes a ZIP, per-file manifest and outer SHA-256 sidecar, but never
uploads or publishes. All four workspace packages are required at runtime.

```powershell
# Maintainer example only; building artifacts requires separate authorization.
.\scripts\build-windows-release.ps1 -Version VERSION -Ref COMMIT -NodeArchive .\node-vPIN-win-x64.zip -NodeSha256 TRUSTED_NODE_SHA256 -OutputDirectory .\dist-windows
```

Native Windows validation still needed before publishing: execute the fixture
tests, build in a clean non-admin Windows runner, install the result offline in
a disposable Unicode/spaced user home with no system Node/npm, and verify real
Feishu + OV setup and stop/start. Check no PATH/config/credential overwrite and
exercise corrupted/missing bundle failures. A successful syntax or fixture test
alone is not release-installation acceptance.

## Tests and current evidence

```powershell
# Only creates small disposable archives/files; no release build/install.
powershell -NoProfile -File .\scripts\test-windows-release.ps1
node --test packages/cli/test/windows-release-launch.test.mjs
```

The PowerShell fixture covers traversal/device-name rejection, case-insensitive
duplicate ZIP paths, archive hash mismatch, full manifest validation, extra
files and altered payload bytes. It never executes its fake binaries. The Node
test exercises bootstrap imports from a Unicode/spaced home and preserves
existing Pi/OV/secrets configuration without writing credentials. Native
PowerShell execution and a real release installation were not performed in the
Linux authoring environment.
