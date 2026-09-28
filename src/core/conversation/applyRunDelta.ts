import type { Block, RunView, RuntimeDelta, SteerTurn, Turn } from './types';

/**
 * Apply one runtime delta to a run view. Mirrors Memoh web `applyRunPatch`
 * (contracts/runtime-ws.md#delta-语义): copy-on-write, so untouched blocks keep
 * their identity and a text append costs O(delta), not O(content).
 * Returns null when there is no run view to patch and the delta carries none.
 */
export function applyRunDelta(run: RunView | null, delta: RuntimeDelta): RunView | null {
  let next: RunView | null = delta.current_run_view
    ? { ...delta.current_run_view, messages: [...(delta.current_run_view.messages ?? [])] }
    : run
      ? { ...run, messages: [...(run.messages ?? [])] }
      : null;
  if (!next) return null;

  const patch = delta.run;
  if (patch && patch.run_id === next.run_id) {
    next = {
      ...next,
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.error_code !== undefined && { error_code: patch.error_code }),
      ...(patch.error !== undefined && { error: patch.error }),
      ...(patch.updated_at !== undefined && { updated_at: patch.updated_at }),
    };
  }

  const messages: Block[] = delta.reset_messages ? [] : [...next.messages];

  const userTurns: Turn[] = [...(next.user_turns ?? [])];
  for (const incoming of delta.user_turn_upserts ?? []) {
    const turnId = incoming.turn_id.trim();
    if (!turnId) continue;
    const index = userTurns.findIndex((turn) => turn.turn_id.trim() === turnId);
    if (index < 0) userTurns.push(incoming);
    else userTurns[index] = incoming;
  }

  let steerTurns: SteerTurn[] = [...(next.steer_turns ?? [])];
  for (const incoming of delta.steer_turn_upserts ?? []) {
    const itemId = incoming.item_id.trim();
    if (!itemId) continue;
    const index = steerTurns.findIndex((turn) => turn.item_id.trim() === itemId);
    if (index < 0) steerTurns.push(incoming);
    else steerTurns[index] = incoming;
  }
  const removed = new Set((delta.steer_turn_removals ?? []).map((id) => id.trim()).filter(Boolean));
  if (removed.size > 0) steerTurns = steerTurns.filter((turn) => !removed.has(turn.item_id.trim()));

  for (const append of delta.message_appends ?? []) {
    const index = messages.findIndex((block) => block.id === append.id && block.type === append.type);
    if (index < 0) {
      messages.push({ id: append.id, type: append.type, content: append.content });
      continue;
    }
    const current = messages[index]!;
    if (current.type !== 'text' && current.type !== 'reasoning') continue;
    messages[index] = { ...current, content: (current.content ?? '') + append.content };
  }

  for (const append of delta.progress_appends ?? []) {
    const index = messages.findIndex((block) => block.id === append.id && block.type === 'tool');
    if (index < 0) continue;
    const current = messages[index]!;
    messages[index] = {
      ...current,
      ...(append.input !== undefined && { input: append.input }),
      progress: [...(current.progress ?? []), append.progress],
    };
  }

  for (const incoming of delta.message_upserts ?? []) {
    const toolCallId = incoming.type === 'tool' ? incoming.tool_call_id?.trim() : '';
    const index = messages.findIndex(
      (block) =>
        block.id === incoming.id ||
        (!!toolCallId && block.type === 'tool' && block.tool_call_id?.trim() === toolCallId),
    );
    if (index < 0) messages.push(incoming);
    else messages[index] = { ...incoming, id: messages[index]!.id };
  }

  messages.sort((left, right) => left.id - right.id);
  return { ...next, messages, user_turns: userTurns, steer_turns: steerTurns };
}
