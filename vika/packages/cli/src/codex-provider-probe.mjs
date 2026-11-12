// Local compatibility patch for the Codex-without-OV experiment.
// Uses Codex's own provider/configuration; never reads or copies credentials.
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const MARKER = 'VIKA_CODEX_READY';

export async function probeCodexProvider(bin, { env = process.env, execFileImpl = execFile, timeoutMs = 90_000 } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vika-codex-provider-'));
  try {
    const execution = execFileImpl(bin, [
      'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
      '-C', workspace, '--json', '--color', 'never',
      '--disable', 'hooks', '--disable', 'shell_tool', '--disable', 'shell_snapshot', '--disable', 'skill_search',
      '-c', 'mcp_servers={}', '-c', 'web_search="disabled"',
      `Reply with exactly ${MARKER}. This is a connectivity check. Do not call tools, read files, or change anything.`,
    ], { env, cwd: workspace, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 });
    // Codex combines piped input with its prompt: EOF is required even when
    // a positional prompt is supplied. execFile leaves stdin open by default.
    execution.child?.stdin?.end();
    const { stdout } = await execution;
    let answer = '', completed = false;
    for (const line of String(stdout).split(/\r?\n/).filter(Boolean)) {
      let event;
      try { event = JSON.parse(line); } catch { return { available: false }; }
      if (event.type === 'error' || event.type === 'turn.failed') return { available: false };
      // Codex may emit a non-fatal diagnostic item before a successful turn.
      // It is not a tool call; the real completed turn and exact answer remain mandatory.
      if (event.item?.type && !['agent_message', 'reasoning', 'error'].includes(event.item.type)) return { available: false };
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') answer = event.item.text;
      if (event.type === 'turn.completed') completed = true;
    }
    return { available: completed && typeof answer === 'string' && answer.trim() === MARKER };
  } catch {
    // Missing/invalid credentials, unsupported CLI flags, network failure and
    // timeouts all fail closed. Raw stderr can contain secrets; never expose it.
    return { available: false };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
