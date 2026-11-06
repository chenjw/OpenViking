import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const launcher = fileURLToPath(new URL('../../../scripts/windows-release-launch.mjs', import.meta.url));

test('release bootstrap uses the real user home and preserves existing credential configuration', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vika 维京 O'Brien "));
  try {
    const scripts = path.join(home, '.vika', 'current', 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'windows-launch.mjs'), `process.stdout.write(JSON.stringify({home:process.env.HOME, profile:process.env.USERPROFILE, secrets:process.env.VIKA_SECRETS_FILE, pi:process.env.PI_CODING_AGENT_DIR, ov:process.env.OPENVIKING_CLI_CONFIG_FILE, args:process.argv.slice(2)}));`);
    const secrets = path.join(home, 'existing-secrets.env');
    const pi = path.join(home, 'existing-pi');
    const ov = path.join(home, 'existing-ov.json');
    const result = JSON.parse(execFileSync(process.execPath, [launcher, 'setup'], {
      encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: path.join(home, 'wrong-home'), VIKA_SECRETS_FILE: secrets, PI_CODING_AGENT_DIR: pi, OPENVIKING_CLI_CONFIG_FILE: ov },
    }));
    assert.deepEqual(result, { home, profile: home, secrets, pi, ov, args: ['setup'] });
    assert.equal(fs.existsSync(secrets), false, 'bootstrap must not write credential files');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
