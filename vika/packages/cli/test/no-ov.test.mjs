// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GoBack, Prompter } from '../src/prompt.mjs';
import { OWNER_MESSAGE_SCOPES, connectLark, larkMessageListener, larkScopes, registerApp, setupCommand } from '../src/setup.mjs';
import { stripAnsi } from '../src/ui.mjs';
import { connectTelegram } from '../src/telegram.mjs';
import { TelegramState } from '../../daemon/src/telegram/state.mjs';
import { configureOpenViking } from '../src/ov-setup.mjs';
import { detectOpenViking, savedOVConfigPath } from '../src/ov.mjs';
import { updateManifest } from '../../daemon/src/deployment-manifest.mjs';

const RUNTIMES = [
  { id: 'codex', label: 'Codex', model: 'codex:', bin: '/opt/codex/bin/codex', binEnv: 'CODEX_BIN', available: true, note: '已登录' },
  { id: 'claude', label: 'Claude Code', model: 'claude:', bin: null, binEnv: 'CLAUDE_BIN', available: false, note: '未安装' },
  { id: 'pi', label: 'Pi（内置）', model: 'pi', bin: null, binEnv: null, available: true, note: 'ok' },
];

function harness(t, answers, { ov = { configPath: null, url: 'http://127.0.0.1:1933', usable: true }, runtimes = RUNTIMES, failStart = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vika-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const input = new PassThrough();
  input.end(answers.map((line) => `${line}\n`).join(''));
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk) => { written += chunk; });
  const calls = [];
  const options = {
    prompter: new Prompter({ input, output }),
    // A Chinese locale settles the language; the English run and the question have tests of their own.
    env: { HOME: home, PATH: '', LARK_CLI_BIN: '/opt/lark/bin/lark-cli', LANG: 'zh_CN.UTF-8' },
    homeDir: home,
    detect: { runtimes: async () => runtimes, openViking: async () => ov },
    // Most tests focus on IM/navigation. The actual OV form is exercised below
    // and in ov-setup.test.mjs, independently of these canned IM answers.
    configureOV: async ({ preferredConfigPath, detect, ...options }) => {
      const detected = await detect({ ...options, configPath: preferredConfigPath });
      return preferredConfigPath ? { ...detected, configPath: preferredConfigPath } : detected;
    },
    connect: {
      qq: async ({ plan }) => { calls.push(['qq', plan.dataDir]); },
      telegram: async ({ plan }) => { calls.push(['telegram', plan.dataDir]); },
      lark: async ({ plan, profile }) => { calls.push(['lark', plan.id, profile]); return { profile, ownerOpenId: 'ou_owner' }; },
      weixin: async ({ plan }) => { calls.push(['weixin', plan.dataDir]); },
      email: async () => {
        calls.push(['email']);
        return { address: 'alice.example@gmail.com', password: 'p', imap: { host: 'imap.gmail.com', port: 993 }, smtp: { host: 'smtp.gmail.com', port: 465 } };
      },
      greet: async (message) => { calls.push(['greet', message.userId, message.text]); },
    },
    control: {
      start: async (target) => { calls.push(['start', target]); if (failStart) throw new Error('pm2 is not installed'); },
      restart: async (target) => { calls.push(['restart', target]); },
      remove: async (targets) => { calls.push(['remove', targets]); },
    },
    // On a terminal setup waits for the owner's message; here it has arrived.
    listen: async ({ port }) => { calls.push(['listen', port]); return { wait: async () => true }; },
    allocate: async () => 3738,
  };
  return { home, options, calls, written: () => written, manifest: () => JSON.parse(fs.readFileSync(path.join(home, '.vika', 'config.json'), 'utf8')) };
}

test('no-OV setup never discovers or contacts OV and saves a working IM instance', async (t) => {
  const h = harness(t, ['Vika', '', '', '1', '1', '', '', 'y']);
  h.options.detect.openViking = async () => { throw new Error('OV must not be contacted'); };
  h.options.configureOV = async () => { throw new Error('OV form must not be opened'); };
  assert.equal(await setupCommand(h.options), 0);
  const agent = h.manifest().agents[0];
  assert.equal(agent.ovConfig, undefined);
  assert.equal(agent.ovAutoRecall, false);
  assert.ok(h.calls.some(([op, id]) => op === 'start' && id === 'primary'));
  assert.ok(!h.calls.some(([op, id]) => op === 'start' && id === 'updater'));
});
