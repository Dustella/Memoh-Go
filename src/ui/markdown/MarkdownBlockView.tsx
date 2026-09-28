import { marked, type Token, type Tokens } from 'marked';
import { memo, useMemo, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { fontSize, monoFont, radius, spacing, useTheme, type Palette } from '../theme';

const CACHE_LIMIT = 4000;
const tokenCache = new Map<string, Token[]>();

/** Lex one block; stable blocks hit the cache, the streaming tail re-lexes. */
function lexBlock(source: string): Token[] {
  const cached = tokenCache.get(source);
  if (cached) return cached;
  const tokens = marked.lexer(source, { gfm: true });
  if (tokenCache.size >= CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(source, tokens);
  return tokens;
}

function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) void Linking.openURL(href);
}

function renderInline(tokens: readonly Token[] | undefined, colors: Palette, keyPrefix: string): ReactNode[] {
  if (!tokens) return [];
  return tokens.map((token, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (token.type) {
      case 'strong':
        return (
          <Text key={key} style={styles.strong}>
            {renderInline((token as Tokens.Strong).tokens, colors, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} style={styles.em}>
            {renderInline((token as Tokens.Em).tokens, colors, key)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} style={styles.del}>
            {renderInline((token as Tokens.Del).tokens, colors, key)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={key} style={[styles.codespan, { backgroundColor: colors.codeBackground, color: colors.codeText }]}>
            {` ${(token as Tokens.Codespan).text} `}
          </Text>
        );
      case 'link': {
        const link = token as Tokens.Link;
        return (
          <Text key={key} style={{ color: colors.accent }} onPress={() => openLink(link.href)} accessibilityRole="link">
            {renderInline(link.tokens, colors, key)}
          </Text>
        );
      }
      case 'br':
        return '\n';
      case 'text': {
        const text = token as Tokens.Text;
        return text.tokens ? <Text key={key}>{renderInline(text.tokens, colors, key)}</Text> : decode(text.text);
      }
      case 'escape':
        return (token as Tokens.Escape).text;
      default:
        return 'raw' in token ? decode(String(token.raw)) : null;
    }
  });
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function renderBlockToken(token: Token, colors: Palette, key: string, bodyStyle: TextStyle): ReactNode {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      const size = heading.depth <= 1 ? 22 : heading.depth === 2 ? 19 : 17;
      return (
        <Text key={key} selectable style={[bodyStyle, styles.heading, { fontSize: size, lineHeight: size * 1.35 }]}>
          {renderInline(heading.tokens, colors, key)}
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Text key={key} selectable style={bodyStyle}>
          {renderInline((token as Tokens.Paragraph).tokens, colors, key)}
        </Text>
      );
    case 'code': {
      const code = token as Tokens.Code;
      return (
        <View key={key} style={[styles.codeBlock, { backgroundColor: colors.codeBackground, borderColor: colors.border }]}>
          {code.lang ? <Text style={[styles.codeLang, { color: colors.textSubtle }]}>{code.lang}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={[styles.codeText, { color: colors.codeText }]}>
              {code.text}
            </Text>
          </ScrollView>
        </View>
      );
    }
    case 'blockquote':
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: colors.border }]}>
          {(token as Tokens.Blockquote).tokens.map((child, index) =>
            renderBlockToken(child, colors, `${key}.${index}`, { ...bodyStyle, color: colors.textMuted }),
          )}
        </View>
      );
    case 'list': {
      const list = token as Tokens.List;
      const start = typeof list.start === 'number' ? list.start : 1;
      return (
        <View key={key} style={styles.list}>
          {list.items.map((item, index) => (
            <View key={`${key}.${index}`} style={styles.listItem}>
              <Text style={[bodyStyle, styles.bullet, { color: colors.textMuted }]}>
                {list.ordered ? `${start + index}.` : '•'}
              </Text>
              <View style={styles.listBody}>
                {item.tokens.map((child, childIndex) =>
                  child.type === 'text' ? (
                    <Text key={`${key}.${index}.${childIndex}`} selectable style={bodyStyle}>
                      {renderInline((child as Tokens.Text).tokens ?? [child], colors, `${key}.${index}.${childIndex}`)}
                    </Text>
                  ) : (
                    renderBlockToken(child, colors, `${key}.${index}.${childIndex}`, bodyStyle)
                  ),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'table': {
      const table = token as Tokens.Table;
      const cellStyle = [styles.cell, { borderColor: colors.border }];
      return (
        <ScrollView key={key} horizontal style={styles.tableScroll} showsHorizontalScrollIndicator={false}>
          <View style={[styles.table, { borderColor: colors.border }]}>
            <View style={[styles.row, { backgroundColor: colors.surfaceMuted }]}>
              {table.header.map((cell, index) => (
                <Text key={index} style={[bodyStyle, styles.strong, ...cellStyle]}>
                  {renderInline(cell.tokens, colors, `${key}.h${index}`)}
                </Text>
              ))}
            </View>
            {table.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((cell, index) => (
                  <Text key={index} selectable style={[bodyStyle, ...cellStyle]}>
                    {renderInline(cell.tokens, colors, `${key}.${rowIndex}.${index}`)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
    case 'hr':
      return <View key={key} style={[styles.hr, { backgroundColor: colors.border }]} />;
    case 'space':
      return null;
    default:
      return 'raw' in token ? (
        <Text key={key} selectable style={bodyStyle}>
          {String(token.raw)}
        </Text>
      ) : null;
  }
}

type MarkdownBlockViewProps = Readonly<{ source: string }>;

/** Renders one top-level Markdown block (see blocks.ts). Memoised on source. */
export const MarkdownBlockView = memo(function MarkdownBlockView({ source }: MarkdownBlockViewProps) {
  const { colors } = useTheme();
  const tokens = useMemo(() => lexBlock(source), [source]);
  const bodyStyle = useMemo<TextStyle>(() => ({ ...styles.body, color: colors.text }), [colors.text]);
  return <View style={styles.block}>{tokens.map((token, index) => renderBlockToken(token, colors, String(index), bodyStyle))}</View>;
});

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  body: { fontSize: fontSize.body, lineHeight: 24 },
  heading: { fontWeight: '600', marginTop: spacing.xs },
  strong: { fontWeight: '600' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  codespan: { fontFamily: monoFont, fontSize: 14, borderRadius: radius.sm },
  codeBlock: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  codeLang: { fontSize: fontSize.caption, marginBottom: spacing.xs },
  codeText: { fontFamily: monoFont, fontSize: 13, lineHeight: 19 },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: spacing.sm },
  list: { gap: spacing.xs },
  listItem: { flexDirection: 'row' },
  bullet: { width: 22 },
  listBody: { flex: 1, gap: spacing.xs },
  tableScroll: { flexGrow: 0 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { minWidth: 96, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
});
