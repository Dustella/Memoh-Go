/**
 * Control requests on a running turn: stop, tool approval, answering a
 * question (contracts/runtime-ws.md). Each carries a client-minted
 * `control_id`, which the server uses as its idempotency key, so a request
 * whose ack was lost is resent with the same id after reconnecting.
 *
 * Controls are deliberately kept in memory only. A decision made before the
 * app was killed is not replayed on the next launch: the user sees the
 * question again and decides with current information (docs/03-sync-contract.md
 * "新的离线审批或停止建议等同步后明确操作，避免旧意图延迟生效").
 */
export type ControlKind = 'abort' | 'tool_approval_response' | 'user_input_response';

/**
 * sending: waiting for an open socket · sent: waiting for control_ack ·
 * applied: server accepted it · stale: the run or decision had already ended ·
 * failed: refused for a reason a resend will not fix.
 */
export type ControlStatus = 'sending' | 'sent' | 'applied' | 'stale' | 'failed';

export type ControlRequest = Readonly<{
  controlId: string;
  kind: ControlKind;
  runId: string;
  sessionId: string;
  /** approval_id / user_input_id; absent for abort. */
  decisionId?: string;
  /** The exact frame; resends reuse it byte for byte. */
  frame: Readonly<Record<string, unknown>>;
  status: ControlStatus;
  attempts: number;
  code?: string;
}>;

export type AnswerInput = Readonly<{
  question_id: string;
  option_ids?: readonly string[];
  custom_text?: string;
  text?: string;
  skipped?: boolean;
}>;

export function abortControl(input: { controlId: string; runId: string; sessionId: string }): ControlRequest {
  return make('abort', input, undefined, { run_id: input.runId, session_id: input.sessionId, control_id: input.controlId });
}

export function approvalControl(input: {
  controlId: string;
  runId: string;
  sessionId: string;
  approvalId: string;
  decision: 'approve' | 'reject';
  optionId?: string;
  reason?: string;
}): ControlRequest {
  return make('tool_approval_response', input, input.approvalId, {
    run_id: input.runId,
    session_id: input.sessionId,
    decision_id: input.approvalId,
    control_id: input.controlId,
    decision: input.decision,
    ...(input.optionId ? { option_id: input.optionId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

export function userInputControl(input: {
  controlId: string;
  runId: string;
  sessionId: string;
  userInputId: string;
  answers?: readonly AnswerInput[];
  canceled?: boolean;
}): ControlRequest {
  return make('user_input_response', input, input.userInputId, {
    run_id: input.runId,
    session_id: input.sessionId,
    decision_id: input.userInputId,
    control_id: input.controlId,
    ...(input.canceled ? { canceled: true } : { answers: input.answers ?? [] }),
  });
}

function make(
  kind: ControlKind,
  ids: { controlId: string; runId: string; sessionId: string },
  decisionId: string | undefined,
  body: Record<string, unknown>,
): ControlRequest {
  if (!ids.controlId || !ids.runId || !ids.sessionId) throw new Error('Control needs control, run and session ids');
  return {
    controlId: ids.controlId,
    kind,
    runId: ids.runId,
    sessionId: ids.sessionId,
    ...(decisionId ? { decisionId } : {}),
    frame: { type: kind, ...body },
    status: 'sending',
    attempts: 0,
  };
}

export const isControlOpen = (c: ControlRequest) => c.status === 'sending' || c.status === 'sent';

export function markControlSent(c: ControlRequest): ControlRequest {
  return c.status === 'sending' ? { ...c, status: 'sent', attempts: c.attempts + 1 } : c;
}

/** The connection dropped before an ack: resend with the same control id. */
export function onControlDisconnected(c: ControlRequest): ControlRequest {
  return c.status === 'sent' ? { ...c, status: 'sending' } : c;
}

/** Codes where the server never processed the request, so a resend may succeed (internal/apperror). */
const RETRYABLE_CODES = new Set(['tool_approval.operation_failed', 'user_input.operation_failed']);
export const MAX_CONTROL_ATTEMPTS = 5;

/**
 * `control_ack`: `applied:true` succeeded; `applied:false` without a code
 * means the run already ended; with a code it was refused, and only
 * delivery failures are worth resending.
 */
export function onControlAck(c: ControlRequest, ack: { applied?: boolean; code?: string }): ControlRequest {
  if (!isControlOpen(c)) return c;
  if (ack.applied) return { ...c, status: 'applied', code: undefined };
  if (!ack.code) return { ...c, status: 'stale' };
  if (RETRYABLE_CODES.has(ack.code) && c.attempts < MAX_CONTROL_ATTEMPTS) return { ...c, status: 'sending', code: ack.code };
  return { ...c, status: 'failed', code: ack.code };
}

/** The decision is no longer pending in the live view (answered elsewhere, expired, run over). */
export function onDecisionSettled(c: ControlRequest): ControlRequest {
  return isControlOpen(c) ? { ...c, status: 'stale' } : c;
}

/** User-facing text for a refused control. */
export function controlFailureText(code: string | undefined): string {
  switch (code) {
    case 'tool_approval.expired':
    case 'user_input.expired':
    case 'tool_approval.not_found':
      return '这个请求已过期或已被处理';
    case 'tool_approval.forbidden':
    case 'user_input.forbidden':
      return '你没有权限处理这个请求';
    case 'tool_approval.ambiguous':
      return '有多个待处理请求，请刷新后重试';
    default:
      return code ? `操作未完成（${code}）` : '操作未完成';
  }
}
