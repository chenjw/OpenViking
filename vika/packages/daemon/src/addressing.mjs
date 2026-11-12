// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0

// Recipient identification, not a model-supplied permission. IDs come only from
// accepted Connector metadata / scoped local message authors. Names require a
// fresh roster and an unambiguous configured bot alias. No network or LLM call.
// The classification is evidence for the model; the Core only vetoes a group
// reply when IDs prove the message called someone else (see vetoReason).
export const ADDRESSEE_KINDS = Object.freeze([
  'direct_self', 'direct_others', 'explicit_self_and_named_others',
  'broadcast', 'no_target', 'unknown',
]);
const SELF_KINDS = new Set(['direct_self', 'explicit_self_and_named_others']);
// Hard vetoes, keyed by the classifier evidence that proves them. A name the
// roster attributes to someone else (roster_named_other) is evidence, not a veto.
export const VETO_REASONS = Object.freeze(['mention_others', 'reply_to_others']);
const VETO_BY_EVIDENCE = new Map([['mention_ids', 'mention_others'], ['scoped_reply_author', 'reply_to_others']]);
const key = value => String(value ?? '').trim().toLocaleLowerCase().replace(/[\s_]+/g, ' ');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENERIC_NAMES = new Set(['bot', 'the bot', 'agent', 'the agent', 'assistant', '机器人', '助手', '大家', '各位', '所有人', '你', '你们', '我', '我们', '他', '她', '它']);

export function broadcastQuestion(text) {
  return /^(?:@(?:all|everyone|here|channel|所有人|全体成员)(?:\s|[，,:：!！?？]|$)|(?:大家|各位|所有人|全体成员)[，,:：\s]*(?:怎么看|觉得|认为|帮|看一下|看下|来|说说|有(?:人|谁|没有|什么)|能不能)|(?:有人|谁)[，,:：\s]*(?:吗|知道|懂|了解|能|可以|帮)|(?:anyone|everyone|everybody|folks)\b|(?:你|您)[\s]*(?:和|跟|与|及)[\s]*(?:大家|各位|所有人|全体成员)|you\s+and\s+(?:everyone|everybody|all)\b)/iu.test(text.trim().replace(/^[，,:：]+\s*/, ''));
}

export function classifyAddressee(event, { self = null, aliases = [], nameEvidence = null, replyAuthor = null } = {}) {
  const selfId = typeof self?.id === 'string' && self.id ? self.id : null;
  const base = { version: 1, event_id: event.eventId, connector_instance: event.connectorInstance,
    scope_key: event.scopeKey, self_id: selfId };
  const answer = (kind, evidence, ids = []) => ({ ...base, kind, evidence, direct_ids: [...new Set(ids)] });
  if (event.chatType === 'p2p') return answer('direct_self', 'direct_chat');
  if (event.chatType !== 'group') return answer('unknown', 'unverified_conversation_type');
  const mentions = Array.isArray(event.mentions) ? event.mentions : [];
  // Never expand @all into a set of members: membership is not direct address.
  const broadcast = event.data?.broadcast_mention === true
    || mentions.some(m => m?.id === 'all' || m?.key === '@_all');
  let text = String(event.content ?? '').trim();
  let withoutMentions = text;
  for (const m of mentions) if (typeof m?.key === 'string' && m.key) withoutMentions = withoutMentions.split(m.key).join(' ');
  withoutMentions = withoutMentions.replace(/^[\s，,:：]+/, '');
  // @-ids that all name others decide the recipient before any text grammar:
  // "@Alice 大家怎么看" calls Alice, not the room (and so not this bot).
  const resolved = mentions.length > 0 && mentions.every(m => typeof m?.id === 'string' && m.id);
  if (!broadcast && selfId && resolved && !mentions.some(m => m.id === selfId)) {
    return answer('direct_others', 'mention_ids', mentions.map(m => m.id));
  }
  if (broadcast || broadcastQuestion(withoutMentions) || broadcastQuestion(event.data?.addressing_text ?? '')) return answer('broadcast', broadcast ? 'broadcast_mention' : 'broad_question');
  if (!selfId) return answer('unknown', 'self_identity_unavailable', mentions.map(m => m?.id).filter(id => typeof id === 'string' && id && id !== 'all'));
  if (mentions.length) {
    if (mentions.some(m => typeof m?.id !== 'string' || !m.id)) return answer('unknown', 'unresolved_mention');
    const ids = [...new Set(mentions.map(m => m.id))];
    return answer(ids.includes(selfId) ? (ids.length === 1 ? 'direct_self' : 'explicit_self_and_named_others') : 'direct_others', 'mention_ids', ids);
  }
  const parent = event.parentId;
  if (parent && parent !== event.messageId && parent !== event.threadRootId) {
    if (!replyAuthor || replyAuthor.kind === 'unknown') return answer('unknown', 'reply_author_unavailable');
    if (replyAuthor.kind === 'self') return answer('direct_self', 'scoped_reply_author', [selfId]);
    if (typeof replyAuthor.id === 'string' && replyAuthor.id) return answer('direct_others', 'scoped_reply_author', [replyAuthor.id]);
    return answer('unknown', 'reply_author_unavailable');
  }
  // Narrow vocatives only, not arbitrary references, quoted names, or model
  // guesses. "Vika，你评价大家的方案" is direct; "大家怎么看" is not.
  for (const alias of [...new Set(aliases.map(key).filter(n => n.length >= 1 && !GENERIC_NAMES.has(n)))]) {
    const match = text.match(new RegExp('^@?' + escape(alias).replace(/ /g, '[ _]+') + '[，,:：!！\\s]+(.+)$', 'iu'));
    if (!match) continue;
    const rest = match[1].trim();
    if (broadcastQuestion(rest)) return answer('broadcast', 'broad_question');
    if (/^(?:(?:不是|并非)(?:在)?问你|没有叫你|not (?:for|addressed to) you\b)/iu.test(rest)) return answer('unknown', 'ambiguous_vocative');
    // A unique name proves identity, not vocative intent. Accept only a small
    // positive request grammar; statements about the bot remain unknown.
    if (!/^(?:请|帮|麻烦|不要|别|你(?:能|可以|来|看|评价|帮|怎么)|please\b|(?:can|could|would) you\b)/iu.test(rest)) {
      return answer('unknown', 'name_without_direct_request');
    }
    const proof = nameEvidence?.(alias);
    if (!proof?.fresh || !proof.selfPresent || !Array.isArray(proof.ids)
      || proof.ids.some(id => id !== selfId)) return answer('unknown', 'name_not_unique_or_unverified');
    return answer('direct_self', 'configured_name_and_roster', [selfId]);
  }
  const named = text.match(/^@?([\p{L}\p{N}][^\n，,:：!?！？]{0,39})[，,:：]\s*(.+)$/u);
  if (named) {
    const label = key(named[1]);
    if (['大家', '各位', '所有人', '全体成员', 'everyone', 'everybody', 'all'].includes(label)) return answer('broadcast', 'broad_vocative');
    const proof = nameEvidence?.(label);
    if (proof?.fresh && Array.isArray(proof.ids) && proof.ids.length === 1 && proof.ids[0] !== selfId) {
      return answer('direct_others', 'roster_named_other', proof.ids);
    }
    return answer('unknown', 'unresolved_vocative');
  }
  return answer(/^(?:你|这个|那个|继续|好的|好[，,。.!！]?$|yes\b|continue\b)/iu.test(text) ? 'unknown' : 'no_target',
    parent === event.threadRootId && parent ? 'thread_membership_only' : 'no_direct_recipient');
}

// Fast pass: the Core itself proved the message calls this bot (an @mention
// id, a quote of its own message, a verified vocative). Daemon-authored group
// notices need it; model replies only need the absence of a veto.
export function permitsSelf(addressing, selfId) {
  return Boolean(addressing && SELF_KINDS.has(addressing.kind) && selfId
    && addressing.self_id === selfId && addressing.direct_ids?.includes(selfId));
}

// A group reply the model cannot override: the message @-mentions only others
// (mention_others) or quote-replies to someone else's message without @-ing
// this bot (reply_to_others). Everything else (no_target, unknown, broadcast,
// names, follow-ups) is the model's call. Works on old frozen rows unchanged.
export function vetoReason(addressing, selfId = addressing?.self_id) {
  if (!addressing || addressing.kind !== 'direct_others' || !Array.isArray(addressing.direct_ids)
    || !addressing.direct_ids.length || (selfId && addressing.direct_ids.includes(selfId))) return null;
  return VETO_BY_EVIDENCE.get(addressing.evidence) ?? null;
}

export function frozenAddressee(value, event, selfId) {
  if (!value || value.version !== 1 || !ADDRESSEE_KINDS.includes(value.kind)
    || value.event_id !== event.eventId || value.connector_instance !== event.connectorInstance
    || value.scope_key !== event.scopeKey || value.self_id !== selfId
    || !Array.isArray(value.direct_ids) || value.direct_ids.some(id => typeof id !== 'string')
    || typeof value.evidence !== 'string') return null;
  if (new Set(value.direct_ids).size !== value.direct_ids.length || value.direct_ids.length > 100) return null;
  if (value.kind === 'direct_self' && (value.direct_ids.length !== 1 || value.direct_ids[0] !== selfId)) return null;
  if (value.kind === 'explicit_self_and_named_others' && (value.direct_ids.length < 2 || !value.direct_ids.includes(selfId))) return null;
  if (value.kind === 'direct_others' && (!value.direct_ids.length || value.direct_ids.includes(selfId))) return null;
  return value;
}
