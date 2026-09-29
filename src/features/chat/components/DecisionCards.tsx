import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { UserInputQuestion, UserInputRequest } from '../../../core/conversation/types';
import { controlFailureText, type AnswerInput } from '../../../core/operations/controls';
import { fontSize, monoFont, radius, spacing, useTheme } from '../../../ui/theme';
import type { ChatRow, ControlView } from '../turnRows';

export type DecisionActions = Readonly<{
  approve: (approvalId: string, decision: 'approve' | 'reject', optionId?: string) => void;
  answer: (userInputId: string, response: { answers: readonly AnswerInput[] } | { canceled: true }) => void;
}>;

const TOOL_LABEL = { running: '运行中', done: '已完成', failed: '失败', awaiting: '等待确认' } as const;
const APPROVAL_LABEL: Record<string, string> = { approved: '已批准', rejected: '已拒绝', expired: '已过期', cancelled: '已取消' };

const inFlight = (c?: ControlView) => c?.status === 'sending' || c?.status === 'sent';

function ControlLine({ control, pendingText }: { control?: ControlView; pendingText: string }) {
  const { colors } = useTheme();
  if (!control) return null;
  if (inFlight(control)) {
    return (
      <View style={styles.inline}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={[styles.small, { color: colors.textMuted }]}>{control.status === 'sending' ? '等待连接后提交…' : '提交中…'}</Text>
      </View>
    );
  }
  if (control.status === 'applied') return <Text style={[styles.small, { color: colors.textMuted }]}>{pendingText}</Text>;
  if (control.status === 'failed') return <Text style={[styles.small, { color: colors.danger }]}>{controlFailureText(control.code)}</Text>;
  return null;
}

function Button({ label, tone, disabled, onPress }: { label: string; tone: 'primary' | 'plain'; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.accent : colors.surface,
          borderColor: primary ? colors.accent : colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? colors.accentText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** A tool call: tap to show input/output; an approval card below when one is attached. */
export function ToolRow({ row, actions }: { row: Extract<ChatRow, { kind: 'tool' }>; actions: DecisionActions }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const tone = row.state === 'failed' ? colors.danger : row.state === 'awaiting' ? colors.warning : colors.textMuted;
  const hasDetail = Boolean(row.input || row.output);
  const approval = row.approval;

  return (
    <View style={styles.toolWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !hasDetail }}
        accessibilityLabel={`工具 ${row.name}，${TOOL_LABEL[row.state]}`}
        disabled={!hasDetail}
        onPress={() => setOpen((v) => !v)}
        style={[styles.tool, { backgroundColor: colors.surfaceMuted }]}
      >
        {row.state === 'running' ? (
          <ActivityIndicator size="small" color={tone} />
        ) : (
          <Ionicons name={row.state === 'failed' ? 'close-circle-outline' : 'construct-outline'} size={14} color={tone} />
        )}
        <Text numberOfLines={1} style={[styles.toolName, { color: colors.text, fontFamily: monoFont }]}>
          {row.name}
          {row.summary ? <Text style={{ color: colors.textMuted }}>{`  ${row.summary}`}</Text> : null}
        </Text>
        <Text style={[styles.small, { color: tone }]}>{TOOL_LABEL[row.state]}</Text>
        {hasDetail ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSubtle} /> : null}
      </Pressable>

      {open ? (
        <View style={[styles.detail, { borderColor: colors.border }]}>
          {row.input ? (
            <>
              <Text style={[styles.detailLabel, { color: colors.textSubtle }]}>输入</Text>
              <Text selectable style={[styles.code, { color: colors.text, fontFamily: monoFont }]}>{row.input}</Text>
            </>
          ) : null}
          {row.output ? (
            <>
              <Text style={[styles.detailLabel, { color: colors.textSubtle }]}>输出</Text>
              <Text selectable style={[styles.code, { color: colors.text, fontFamily: monoFont }]}>{row.output}</Text>
            </>
          ) : null}
        </View>
      ) : null}

      {approval ? (
        approval.status === 'pending' ? (
          <View style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.surface }]}>
            <View style={styles.inline}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.warning} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>需要你的批准</Text>
            </View>
            {row.summary ? (
              <Text selectable style={[styles.code, { color: colors.text, fontFamily: monoFont }]} numberOfLines={6}>
                {row.summary}
              </Text>
            ) : null}
            {!row.interactive ? (
              <Text style={[styles.small, { color: colors.textMuted }]}>等待批准</Text>
            ) : approval.can_approve === false ? (
              <Text style={[styles.small, { color: colors.textMuted }]}>你没有批准权限，等待有权限的成员处理</Text>
            ) : (
              <>
                <View style={styles.buttons}>
                  {approval.options?.length ? (
                    approval.options.map((o) => {
                      const reject = /reject|deny/i.test(o.kind ?? o.id);
                      return (
                        <Button
                          key={o.id}
                          label={o.name || o.id}
                          tone={reject ? 'plain' : 'primary'}
                          disabled={inFlight(row.control)}
                          onPress={() => actions.approve(approval.approval_id, reject ? 'reject' : 'approve', o.id)}
                        />
                      );
                    })
                  ) : (
                    <>
                      <Button label="拒绝" tone="plain" disabled={inFlight(row.control)} onPress={() => actions.approve(approval.approval_id, 'reject')} />
                      <Button label="批准" tone="primary" disabled={inFlight(row.control)} onPress={() => actions.approve(approval.approval_id, 'approve')} />
                    </>
                  )}
                </View>
                <ControlLine control={row.control} pendingText="已提交，等待执行…" />
              </>
            )}
          </View>
        ) : (
          <Text style={[styles.small, styles.resolved, { color: colors.textMuted }]}>
            {APPROVAL_LABEL[approval.status] ?? approval.status}
            {approval.decision_reason ? `：${approval.decision_reason}` : ''}
          </Text>
        )
      ) : null}
    </View>
  );
}

type Draft = Readonly<{ options: readonly string[]; custom: string; text: string }>;
const EMPTY: Draft = { options: [], custom: '', text: '' };

function isAnswered(q: UserInputQuestion, d: Draft) {
  if (q.kind === 'text') return d.text.trim().length > 0;
  return d.options.length > 0 || d.custom.trim().length > 0;
}

function toAnswer(q: UserInputQuestion, d: Draft): AnswerInput {
  if (q.kind === 'text') return d.text.trim() ? { question_id: q.id, text: d.text.trim() } : { question_id: q.id, skipped: true };
  const custom = d.custom.trim();
  if (!d.options.length && !custom) return { question_id: q.id, skipped: true };
  return { question_id: q.id, ...(d.options.length ? { option_ids: d.options } : {}), ...(custom ? { custom_text: custom } : {}) };
}

function answerSummary(request: UserInputRequest): string {
  if (!request.answers?.length) return '';
  return request.answers
    .map((a) => {
      if (a.skipped) return '（跳过）';
      const parts = [...(a.selected ?? []).map((s) => s.label), a.custom_text, a.text].filter(Boolean);
      return parts.join('、');
    })
    .filter(Boolean)
    .join('；');
}

/** An ask_user question from the agent. Mount with key = user_input_id so answers never leak between rows. */
export function QuestionCard({ row, actions }: { row: Extract<ChatRow, { kind: 'question' }>; actions: DecisionActions }) {
  const { colors } = useTheme();
  const { request } = row;
  const questions = request.questions ?? [];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftOf = (id: string) => drafts[id] ?? EMPTY;
  const update = (id: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? EMPTY), ...patch } }));

  if (request.status !== 'pending') {
    const summary = answerSummary(request);
    const label = request.status === 'submitted' ? `已回答${summary ? `：${summary}` : ''}` : request.status === 'canceled' ? '已跳过' : request.status === 'expired' ? '已过期' : request.status;
    return (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {questions.map((q) => (
          <Text key={q.id} style={[styles.questionText, { color: colors.textMuted }]}>{q.text}</Text>
        ))}
        <Text style={[styles.small, { color: colors.textMuted }]}>{label}</Text>
      </View>
    );
  }

  const canAnswer = row.interactive && request.can_respond !== false;
  const busy = inFlight(row.control) || row.control?.status === 'applied';
  const ready = questions.every((q) => q.required === false || isAnswered(q, draftOf(q.id)));

  return (
    <View style={[styles.card, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
      <View style={styles.inline}>
        <Ionicons name="help-circle-outline" size={16} color={colors.accent} />
        <Text style={[styles.cardTitle, { color: colors.text }]}>需要你回答</Text>
      </View>
      {questions.map((q) => {
        const d = draftOf(q.id);
        return (
          <View key={q.id} style={styles.question}>
            <Text style={[styles.questionText, { color: colors.text }]}>{q.text}</Text>
            {q.kind === 'text' ? (
              <TextInput
                value={d.text}
                onChangeText={(text) => update(q.id, { text })}
                editable={canAnswer && !busy}
                placeholder={q.placeholder || '输入回答'}
                placeholderTextColor={colors.textSubtle}
                multiline
                style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
              />
            ) : (
              <View style={styles.options}>
                {(q.options ?? []).map((o) => {
                  const selected = d.options.includes(o.id);
                  return (
                    <Pressable
                      key={o.id}
                      accessibilityRole={q.kind === 'multi_select' ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: selected, disabled: !canAnswer || busy }}
                      disabled={!canAnswer || busy}
                      onPress={() =>
                        update(q.id, {
                          options:
                            q.kind === 'multi_select'
                              ? selected
                                ? d.options.filter((x) => x !== o.id)
                                : [...d.options, o.id]
                              : selected
                                ? []
                                : [o.id],
                        })
                      }
                      style={[
                        styles.option,
                        {
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.userBubble : colors.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: colors.text }]}>{o.label}</Text>
                      {o.description ? <Text style={[styles.small, { color: colors.textMuted }]}>{o.description}</Text> : null}
                    </Pressable>
                  );
                })}
                {q.allow_custom ? (
                  <TextInput
                    value={d.custom}
                    onChangeText={(custom) => update(q.id, { custom })}
                    editable={canAnswer && !busy}
                    placeholder="其他答案"
                    placeholderTextColor={colors.textSubtle}
                    style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
                  />
                ) : null}
              </View>
            )}
          </View>
        );
      })}
      {canAnswer ? (
        <>
          <View style={styles.buttons}>
            <Button label="跳过" tone="plain" disabled={busy} onPress={() => actions.answer(request.user_input_id, { canceled: true })} />
            <Button
              label="提交"
              tone="primary"
              disabled={busy || !ready}
              onPress={() => actions.answer(request.user_input_id, { answers: questions.map((q) => toAnswer(q, draftOf(q.id))) })}
            />
          </View>
          <ControlLine control={row.control} pendingText="已提交，等待继续…" />
        </>
      ) : (
        <Text style={[styles.small, { color: colors.textMuted }]}>{row.interactive ? '你不能回答这个问题' : '等待回答'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolWrap: { gap: spacing.xs, alignItems: 'stretch' },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toolName: { fontSize: fontSize.small, flexShrink: 1 },
  small: { fontSize: fontSize.small },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  detail: { borderLeftWidth: 2, paddingLeft: spacing.md, gap: spacing.xs, marginLeft: spacing.sm },
  detailLabel: { fontSize: fontSize.caption, marginTop: spacing.xs },
  code: { fontSize: fontSize.caption, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTitle: { fontSize: fontSize.body, fontWeight: '600' },
  resolved: { paddingLeft: spacing.sm },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  button: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 40, justifyContent: 'center' },
  buttonText: { fontSize: fontSize.body, fontWeight: '600' },
  question: { gap: spacing.xs },
  questionText: { fontSize: fontSize.body, lineHeight: 22 },
  options: { gap: spacing.xs },
  option: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  optionText: { fontSize: fontSize.body },
  input: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.body, minHeight: 44 },
});
