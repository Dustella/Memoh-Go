import { memo, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MarkdownBlockView } from '../../../ui/markdown/MarkdownBlockView';
import { fontSize, radius, spacing, useTheme } from '../../../ui/theme';

export type MessageRowData = Readonly<{
  key: string;
  role: 'user' | 'assistant';
  source: string;
  first: boolean;
}>;

type MessageRowProps = Readonly<{ row: MessageRowData; anchorRef?: Ref<View> }>;

/**
 * One virtualised chat row: a user bubble, or a single Markdown block of an
 * assistant turn. Long answers therefore virtualise block by block.
 */
export const MessageRow = memo(function MessageRow({ row, anchorRef }: MessageRowProps) {
  const { colors } = useTheme();
  if (row.role === 'user') {
    return (
      <View ref={anchorRef} collapsable={false} style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
          <Text selectable style={[styles.userText, { color: colors.userBubbleText }]}>
            {row.source}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View ref={anchorRef} collapsable={false} style={[styles.assistantRow, row.first && styles.assistantFirst]}>
      <MarkdownBlockView source={row.source} />
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, alignItems: 'flex-end' },
  userBubble: { maxWidth: '85%', borderRadius: radius.lg, borderBottomRightRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: fontSize.body, lineHeight: 23 },
  assistantRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  assistantFirst: { paddingTop: spacing.lg },
});
