/**
 * Server-authoritative conversation shapes. Field names follow the Memoh wire
 * format (contracts/runtime-ws.md) on purpose: the runtime projection is owned
 * by the server, so renaming would only add a lossy mapping layer.
 */

export type BlockType = 'text' | 'reasoning' | 'tool' | 'attachments' | 'error' | 'notice';

export type Attachment = Readonly<{
  id?: string;
  type: string;
  name?: string;
  mime?: string;
  size?: number;
  url?: string;
  path?: string;
  content_hash?: string;
}>;

export type ToolApproval = Readonly<{
  approval_id: string;
  short_id?: number;
  status: string;
  decision_reason?: string;
  can_approve?: boolean;
  options?: readonly { id: string; name?: string; kind?: string }[];
  selected_option_id?: string;
}>;

export type UserInputQuestion = Readonly<{
  id: string;
  text: string;
  kind: 'single_select' | 'multi_select' | 'text';
  options?: readonly { id: string; label: string; description?: string }[];
  allow_custom?: boolean;
  required?: boolean;
  placeholder?: string;
}>;

export type UserInputRequest = Readonly<{
  user_input_id: string;
  status: string;
  questions?: readonly UserInputQuestion[];
  /** Display projection of what was answered (internal/agent/decision/input UIAnswer). */
  answers?: readonly Readonly<{
    question_id: string;
    question?: string;
    selected?: readonly { id: string; label: string }[];
    custom_text?: string;
    text?: string;
    skipped?: boolean;
  }>[];
  can_respond?: boolean;
}>;

/** One content block of an assistant turn. `id` is the block index. */
export type Block = Readonly<{
  id: number;
  type: BlockType;
  content?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  tool_call_id?: string;
  running?: boolean;
  progress?: readonly unknown[];
  approval?: ToolApproval;
  user_input?: UserInputRequest;
  execution_location?: Readonly<{ kind: string; name: string }>;
  attachments?: readonly Attachment[];
  reasoning_timing?: Readonly<{ duration_ms: number }>;
  code?: string;
}>;

export type Turn = Readonly<{
  turn_id: string;
  /** Immutable admission order; absent on live (not yet persisted) turns. */
  turn_position?: number;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  messages?: readonly Block[];
  attachments?: readonly Attachment[];
  timestamp: string;
  sender_display_name?: string;
  /** Stored message id of the turn head; absent until persisted. */
  id?: string;
}>;

export const ACTIVE_RUN_STATUSES = [
  'admitting',
  'running',
  'waiting_decision',
  'aborting',
  'finishing',
] as const;
export const TERMINAL_RUN_STATUSES = ['completed', 'aborted', 'errored', 'lost'] as const;

export type RunStatus =
  | (typeof ACTIVE_RUN_STATUSES)[number]
  | (typeof TERMINAL_RUN_STATUSES)[number];

export function isRunActive(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

export type SteerTurn = Readonly<{
  item_id: string;
  status: 'claimed' | 'applied';
  text: string;
  turn_id?: string;
  after_message_id: number;
  timestamp: string;
}>;

export type RunView = Readonly<{
  run_id: string;
  turn_id: string;
  invocation_id?: string;
  status: RunStatus | string;
  started_at: string;
  updated_at: string;
  messages: readonly Block[];
  user_turns?: readonly Turn[];
  steer_turns?: readonly SteerTurn[];
  steer_supported?: boolean;
  /**
   * CH-14: this run replaces the history tail starting at this message
   * (retry: the reply; edit: the user message). Verified on the dev stack:
   * the replacement is a new turn, and the kept user message moves into it.
   */
  operation?: Readonly<{ kind: 'retry' | 'edit' | string; replace_from_message_id?: string; replacement_user_turn?: Turn }>;
  error_code?: string;
  error?: string;
}>;

export type RunPatch = Readonly<{
  run_id: string;
  status?: string;
  error_code?: string;
  error?: string;
  updated_at?: string;
}>;

export type RuntimeDelta = Readonly<{
  current_run_view?: RunView;
  run?: RunPatch;
  user_turn_upserts?: readonly Turn[];
  steer_turn_upserts?: readonly SteerTurn[];
  steer_turn_removals?: readonly string[];
  message_appends?: readonly { id: number; type: BlockType; content: string }[];
  progress_appends?: readonly { id: number; progress: unknown; input?: unknown }[];
  message_upserts?: readonly Block[];
  reset_messages?: boolean;
}>;

export type RuntimeSnapshot = Readonly<{
  bot_id: string;
  session_id: string;
  epoch: string;
  seq: number;
  current_run_view?: RunView | null;
  updated_at: string;
}>;
