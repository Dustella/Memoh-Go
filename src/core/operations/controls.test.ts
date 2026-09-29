import { describe, expect, it } from 'vitest';

import {
  MAX_CONTROL_ATTEMPTS,
  abortControl,
  approvalControl,
  markControlSent,
  onControlAck,
  onControlDisconnected,
  onDecisionSettled,
  userInputControl,
} from './controls';

const ids = { controlId: 'c1', runId: 'r1', sessionId: 's1' };

describe('control frames', () => {
  it('builds the wire frames from contracts/runtime-ws.md', () => {
    expect(abortControl(ids).frame).toEqual({ type: 'abort', run_id: 'r1', session_id: 's1', control_id: 'c1' });
    expect(approvalControl({ ...ids, approvalId: 'a1', decision: 'approve', optionId: 'allow_once' }).frame).toEqual({
      type: 'tool_approval_response',
      run_id: 'r1',
      session_id: 's1',
      decision_id: 'a1',
      control_id: 'c1',
      decision: 'approve',
      option_id: 'allow_once',
    });
    expect(userInputControl({ ...ids, userInputId: 'u1', answers: [{ question_id: 'q1', option_ids: ['o2'] }] }).frame).toEqual({
      type: 'user_input_response',
      run_id: 'r1',
      session_id: 's1',
      decision_id: 'u1',
      control_id: 'c1',
      answers: [{ question_id: 'q1', option_ids: ['o2'] }],
    });
    expect(userInputControl({ ...ids, userInputId: 'u1', canceled: true }).frame).toMatchObject({ canceled: true });
    expect(userInputControl({ ...ids, userInputId: 'u1', canceled: true }).frame).not.toHaveProperty('answers');
  });

  it('refuses a control without ids', () => {
    expect(() => abortControl({ ...ids, runId: '' })).toThrow();
  });
});

describe('control lifecycle', () => {
  const sent = markControlSent(abortControl(ids));

  it('applied, or stale when the run already ended', () => {
    expect(onControlAck(sent, { applied: true }).status).toBe('applied');
    expect(onControlAck(sent, { applied: false }).status).toBe('stale');
  });

  it('a lost ack is resent with the same control id after reconnecting', () => {
    const again = onControlDisconnected(sent);
    expect(again).toMatchObject({ status: 'sending', controlId: 'c1', frame: sent.frame });
    expect(markControlSent(again).attempts).toBe(2);
  });

  it('retries delivery failures, not refusals', () => {
    const c = markControlSent(approvalControl({ ...ids, approvalId: 'a1', decision: 'reject' }));
    expect(onControlAck(c, { applied: false, code: 'tool_approval.operation_failed' }).status).toBe('sending');
    expect(onControlAck(c, { applied: false, code: 'tool_approval.expired' })).toMatchObject({ status: 'failed', code: 'tool_approval.expired' });
    let tired = c;
    for (let i = 1; i < MAX_CONTROL_ATTEMPTS; i++) tired = markControlSent(onControlAck(tired, { code: 'tool_approval.operation_failed' }));
    expect(onControlAck(tired, { code: 'tool_approval.operation_failed' }).status).toBe('failed');
  });

  it('a decision settled elsewhere closes the request; closed requests ignore late acks', () => {
    const settled = onDecisionSettled(sent);
    expect(settled.status).toBe('stale');
    expect(onControlAck(settled, { applied: true })).toBe(settled);
  });
});
