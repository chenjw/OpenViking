import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { probeCodexProvider } from '../src/codex-provider-probe.mjs';
import { detectRuntimes } from '../src/runtimes.mjs';

const response = (...events) => events.map(e => JSON.stringify(e)).join('\n');
const answer = { type: 'item.completed', item: { type: 'agent_message', text: 'VIKA_CODEX_READY' } };
const done = { type: 'turn.completed', usage: {} };

test('external provider probe uses the real HOME/config, no tools, no login and removes its empty workspace', async () => {
  const env = { HOME: '/real-user', CODEX_HOME: '/real-codex', CUSTOM_API_KEY: 'test-only' };
  let workspace;
  const result = await probeCodexProvider('/bin/codex', { env, execFileImpl: async (bin, args, options) => {
    assert.equal(bin, '/bin/codex'); assert.equal(options.env, env);
    assert.equal(args[0], 'exec'); assert.ok(args.includes('--ephemeral'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    for (const control of ['hooks', 'shell_tool', 'shell_snapshot', 'skill_search', 'mcp_servers={}', 'web_search="disabled"']) assert.ok(args.includes(control));
    assert.ok(!args.includes('--model') && !args.includes('--profile') && !args.includes('--ignore-user-config'));
    workspace = options.cwd; assert.deepEqual(fs.readdirSync(workspace), []);
    assert.equal(options.timeout, 90_000); assert.equal(options.killSignal, 'SIGKILL');
    return { stdout: response(answer, done) };
  } });
  assert.equal(result.available, true); assert.equal(fs.existsSync(workspace), false);
});

for (const [name, events] of [
  ['empty output', []], ['no completed turn', [answer]],
  ['wrong answer', [{ ...answer, item: { type: 'agent_message', text: 'not ready' } }, done]],
  ['tool use', [{ type: 'item.started', item: { type: 'mcp_tool_call' } }, answer, done]],
  ['failed turn', [answer, { type: 'turn.failed' }]],
]) test(`provider probe rejects ${name}`, async () => {
  const result = await probeCodexProvider('/bin/codex', { execFileImpl: async () => ({ stdout: response(...events) }) });
  assert.equal(result.available, false);
});

test('missing/invalid credentials or a timeout fails closed without leaking stderr', async () => {
  for (const error of [Object.assign(new Error('credential secret'), { stderr: 'secret', code: 1 }), Object.assign(new Error('timeout'), { killed: true })]) {
    const result = await probeCodexProvider('/bin/codex', { execFileImpl: async () => { throw error; } });
    assert.deepEqual(result, { available: false });
  }
});

for (const [loggedIn, providerWorks, expected] of [[false, true, true], [false, false, false], [true, false, true]]) {
  test(`runtime availability: login=${loggedIn}, verified provider=${providerWorks}`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vika-provider-detect-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n', { mode: 0o755 });
    let probes = 0;
    const runtime = (await detectRuntimes({ env: { HOME: dir, PATH: dir }, piBin: '/missing/pi',
      execFileImpl: async (bin, args) => {
        if (args[0] === 'login') { if (!loggedIn) throw new Error('not logged in'); return { stdout: 'logged in' }; }
        return { stdout: '[]' };
      },
      codexProviderProbe: async () => { probes++; return { available: providerWorks }; },
    })).find(r => r.id === 'codex');
    assert.equal(runtime.available, expected); assert.equal(probes, loggedIn ? 0 : 1);
    if (!loggedIn && providerWorks) { assert.match(runtime.note, /provider/); assert.doesNotMatch(runtime.note, /^已登录$/); }
  });
}

// Regression for a real subprocess: mocks cannot detect an unclosed stdin.
test('the real subprocess receives stdin EOF and can finish its model probe', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vika-codex-eof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'codex');
  const output = response(answer, done);
  fs.writeFileSync(bin, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(output)}));\n`, { mode: 0o755 });
  assert.equal((await probeCodexProvider(bin, { timeoutMs: 2000 })).available, true);
});

test('non-fatal Codex diagnostic does not hide a successful real model reply', async () => {
  const warning = { type: 'item.completed', item: { type: 'error', message: 'non-fatal startup diagnostic' } };
  const success = await probeCodexProvider('/bin/codex', { execFileImpl: async () => ({ stdout: response(warning, answer, done) }) });
  assert.equal(success.available, true);
  const noReply = await probeCodexProvider('/bin/codex', { execFileImpl: async () => ({ stdout: response(warning, done) }) });
  assert.equal(noReply.available, false);
});
