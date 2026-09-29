import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontSize, spacing, useTheme } from '../../ui/theme';
import { QuestionCard, ToolRow, type DecisionActions } from '../chat/components/DecisionCards';
import type { ChatRow, ControlView } from '../chat/turnRows';

/**
 * DEV-ONLY MOCK (docs/HANDOFF.md): the dev stack's model never calls tools,
 * so approvals and ask_user questions cannot be produced live yet. These
 * fixture rows follow the server view types (internal/agent/view/uimessage.go
 * UIToolApproval, internal/agent/decision/input UIQuestion) and exist only to
 * check the cards visually. Buttons change local state; nothing is sent.
 */
type Tool = Extract<ChatRow, { kind: 'tool' }>;
type Question = Extract<ChatRow, { kind: 'question' }>;

const exec: Tool = {
  kind: 'tool',
  key: 'mock:exec',
  turnId: 'mock',
  name: 'exec',
  state: 'awaiting',
  first: true,
  summary: 'rm -rf /data/build && npm run build',
  input: JSON.stringify({ command: 'rm -rf /data/build && npm run build', target_id: 'native' }, null, 2),
  approval: { approval_id: 'mock-approval', status: 'pending', can_approve: true },
  interactive: true,
};

const done: Tool = {
  kind: 'tool',
  key: 'mock:read',
  turnId: 'mock',
  name: 'read',
  state: 'done',
  first: false,
  summary: '/data/notes/todo.md',
  input: JSON.stringify({ path: '/data/notes/todo.md' }, null, 2),
  output: '# TODO\n- ship M2\n- review PR #1405',
  approval: { approval_id: 'mock-approved', status: 'approved' },
  interactive: false,
};

const question: Question = {
  kind: 'question',
  key: 'mock:ask',
  turnId: 'mock',
  first: false,
  interactive: true,
  request: {
    user_input_id: 'mock-question',
    status: 'pending',
    questions: [
      {
        id: 'q1',
        text: '部署到哪个环境？',
        kind: 'single_select',
        allow_custom: true,
        options: [
          { id: 'staging', label: '预发布', description: '先在 staging 验证' },
          { id: 'prod', label: '生产' },
        ],
      },
      { id: 'q2', text: '需要通知谁？', kind: 'text', placeholder: '例如 @ops' },
    ],
  },
};

const answered: Question = {
  kind: 'question',
  key: 'mock:answered',
  turnId: 'mock',
  first: false,
  interactive: false,
  request: {
    user_input_id: 'mock-answered',
    status: 'submitted',
    questions: [{ id: 'q1', text: '你更喜欢哪种颜色？', kind: 'single_select' }],
    answers: [{ question_id: 'q1', selected: [{ id: 'g', label: '绿色' }] }],
  },
};

export function DecisionPreviewScreen() {
  const { colors } = useTheme();
  const [controls, setControls] = useState<Record<string, ControlView>>({});
  const actions: DecisionActions = {
    approve: (id) => {
      setControls((c) => ({ ...c, [id]: { status: 'sent' } }));
      setTimeout(() => setControls((c) => ({ ...c, [id]: { status: 'failed', code: 'tool_approval.expired' } })), 1200);
    },
    answer: (id) => {
      setControls((c) => ({ ...c, [id]: { status: 'sent' } }));
      setTimeout(() => setControls((c) => ({ ...c, [id]: { status: 'applied' } })), 1200);
    },
  };
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.body}>
      <Text style={[styles.note, { color: colors.warning }]}>开发预览（模拟数据，不会发送到服务器）</Text>
      <ToolRow row={{ ...exec, control: controls['mock-approval'] }} actions={actions} />
      <ToolRow row={done} actions={actions} />
      <View style={styles.gap} />
      <QuestionCard row={{ ...question, control: controls['mock-question'] }} actions={actions} />
      <QuestionCard row={answered} actions={actions} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  note: { fontSize: fontSize.small },
  gap: { height: spacing.sm },
});
