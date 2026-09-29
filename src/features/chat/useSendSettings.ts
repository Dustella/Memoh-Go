import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SendOptions } from '../../application/conversation/liveSession';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { loadUiState, saveUiState } from '../../data/local/userStateStore';
import type { ModelOption, WorkspaceTarget } from '../../data/remote/memohClient';
import { useRemote } from '../resources/useRemote';

/** What the user picked for this session; empty fields mean "the session's own preference". */
export type SendSettings = Readonly<{ modelId?: string; reasoningEffort?: string; workspaceTargetId?: string }>;

const key = (botId: string, sessionId: string) => `send:${botId}/${sessionId}`;

/**
 * CH-17/18: model, reasoning effort and execution location for the next
 * sends in one session. Kept on this device per session and sent as
 * per-message overrides (`model_id`, `reasoning_effort`,
 * `workspace_target_id`); the app does not rewrite the session's stored
 * preference on the server. Options are read from `/models` and
 * `/bots/:id/workspace-targets`.
 */
export function useSendSettings(botId: string, sessionId: string) {
  const { db } = useServices();
  const state = useAccessState();
  const scope = state.kind === 'signed_in' ? state.session.scope : null;
  const [settings, setSettings] = useState<SendSettings>({});
  const loaded = useRef(false);
  const models = useRemote((c, token) => c.listModels(token), []);
  const targets = useRemote((c, token) => c.listWorkspaceTargets(token, botId), [botId]);

  useEffect(() => {
    if (!scope) return;
    loaded.current = false;
    void loadUiState<SendSettings>(db, scope, key(botId, sessionId)).then((saved) => {
      setSettings(saved ?? {});
      loaded.current = true;
    });
  }, [db, scope, botId, sessionId]);

  const update = useCallback(
    (patch: Partial<SendSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        // A model change clears an effort the new model may not offer.
        if (patch.modelId !== undefined && patch.modelId !== prev.modelId && patch.reasoningEffort === undefined) delete (next as { reasoningEffort?: string }).reasoningEffort;
        for (const k of Object.keys(next) as (keyof SendSettings)[]) if (!next[k]) delete (next as Record<string, unknown>)[k];
        if (scope) void saveUiState(db, scope, key(botId, sessionId), next, Date.now());
        return next;
      });
    },
    [db, scope, botId, sessionId],
  );

  const chatModels: ModelOption[] = useMemo(() => (models.data ?? []).filter((m) => (m.type ?? 'chat') === 'chat' && m.enable !== false), [models.data]);
  const model = chatModels.find((m) => m.id === settings.modelId);
  const target: WorkspaceTarget | undefined = (targets.data ?? []).find((x) => x.target_id === settings.workspaceTargetId);

  // A saved choice that no longer exists is dropped rather than sent.
  const options: SendOptions = {
    modelId: model ? model.id : undefined,
    reasoningEffort: model?.reasoning?.supported && settings.reasoningEffort ? settings.reasoningEffort : undefined,
    workspaceTargetId: target ? target.target_id : undefined,
  };

  return { settings, update, options, models: chatModels, targets: targets.data ?? [], model, target };
}
