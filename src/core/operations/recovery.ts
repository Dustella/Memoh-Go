import {
  fallbackMode,
  observeLookupSupport,
  recoveryMode,
  type ServerCapabilities,
} from '../identity/capabilities';
import type { LookupOutcome } from './invocationLookup';
import type { Recovery } from './outbox';

/**
 * First step for an unconfirmed send: `lookup` means call the lookup endpoint
 * and feed the outcome to `afterLookup`; otherwise apply the returned step.
 */
export function planRecovery(caps: ServerCapabilities): 'lookup' | Recovery {
  const mode = recoveryMode(caps);
  if (mode === 'lookup') return 'lookup';
  return mode === 'resend' ? { kind: 'resend' } : { kind: 'await_user' };
}

function fallbackStep(caps: ServerCapabilities): Recovery {
  return fallbackMode(caps) === 'resend' ? { kind: 'resend' } : { kind: 'await_user' };
}

export function afterLookup(
  caps: ServerCapabilities,
  outcome: LookupOutcome,
): { caps: ServerCapabilities; step: Recovery } {
  switch (outcome.kind) {
    case 'found':
      return {
        caps: observeLookupSupport(caps, true),
        step: { kind: 'found', runId: outcome.runId, turnId: outcome.turnId },
      };
    case 'not_found':
      return { caps: observeLookupSupport(caps, true), step: { kind: 'not_found' } };
    case 'unsupported': {
      // Older server: remember it for this build and take the fallback path now.
      const next = observeLookupSupport(caps, false);
      return { caps: next, step: fallbackStep(next) };
    }
    case 'unavailable':
      if (outcome.reason === 'session_not_found') return { caps, step: { kind: 'fail', code: 'session_not_found' } };
      // A proven lookup is worth waiting for; otherwise do not stall on a probe.
      return { caps, step: caps.invocationLookup === 'yes' ? { kind: 'retry_later' } : fallbackStep(caps) };
  }
}
