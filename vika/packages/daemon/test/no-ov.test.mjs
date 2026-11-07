// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { startMockEnv, textMessage } from './mock-env.mjs';
import { assembleConversationPolicy } from '../src/conversation-policy.mjs';

test('no-OV daemon starts and delivers input without accessing OV or publishing OV tools', async () => {
  const never = () => { throw new Error('OV must not be accessed'); };
  const env = await startMockEnv({
    config: { openVikingDisabled: true, openVikingConfigPath: '', timerStorage: 'sqlite' },
    ovClient: new Proxy({}, { get: never }), ovCheck: never,
  });
  try {
    assert.equal(env.daemon.ready, true);
    assert.equal(env.daemon.ovContext, null);
    assert.equal(env.daemon.ovSyncTimer, null);
    assert.ok(!env.daemon.actions.tools().some(t => t.name === 'read_openviking_session_context'));
    assert.deepEqual(await env.daemon.store.prepareOVContext(1), { messages: [] });
    assert.deepEqual(env.daemon.store.getOVContext(2), { messages: [] });
    env.receive(textMessage({ messageId: 'om-no-ov', text: 'hello without OV' }));
    await env.waitForCodexInput(/om-no-ov/);
  } finally { await env.stop(); }
});

test('policy does not instruct the agent to use OV memory', () => {
  const policy = assembleConversationPolicy({ openVikingDisabled: true });
  assert.ok(policy.includes('OpenViking is disabled'));
  assert.ok(!policy.includes('OpenViking is your long-term memory'));
});
