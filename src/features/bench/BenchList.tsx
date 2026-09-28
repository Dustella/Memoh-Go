import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { forwardRef, useCallback, useImperativeHandle, useRef, type ReactElement } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { ChatRow } from './scenarios';

export type ListImpl = 'flat' | 'flash' | 'legend';
export const LIST_IMPLS: readonly { id: ListImpl; label: string }[] = [
  { id: 'flat', label: 'FlatList' },
  { id: 'flash', label: 'FlashList' },
  { id: 'legend', label: 'Legend' },
];

export type BenchListHandle = Readonly<{
  scrollToOffset: (offset: number, animated: boolean) => void;
  scrollToEnd: (animated: boolean) => void;
  scrollToIndex: (index: number) => void;
  metrics: () => { contentHeight: number; viewportHeight: number; offset: number };
}>;

type BenchListProps = Readonly<{
  impl: ListImpl;
  rows: readonly ChatRow[];
  renderRow: (row: ChatRow) => ReactElement;
  extraData?: unknown;
}>;

const keyExtractor = (row: ChatRow) => row.key;
const END_THRESHOLD = 48;

/** Chat-style list (newest at bottom, sticks to the end while at the end). */
export const BenchList = forwardRef<BenchListHandle, BenchListProps>(function BenchList(
  { impl, rows, renderRow, extraData },
  ref,
) {
  const flat = useRef<FlatList<ChatRow>>(null);
  const flash = useRef<FlashListRef<ChatRow>>(null);
  const legend = useRef<LegendListRef>(null);
  const measures = useRef({ contentHeight: 0, viewportHeight: 0, offset: 0, atEnd: true });

  useImperativeHandle(
    ref,
    () => ({
      scrollToOffset(offset, animated) {
        if (impl === 'flat') flat.current?.scrollToOffset({ offset, animated });
        else if (impl === 'flash') flash.current?.scrollToOffset({ offset, animated });
        else void legend.current?.scrollToOffset({ offset, animated });
      },
      scrollToEnd(animated) {
        if (impl === 'flat') flat.current?.scrollToEnd({ animated });
        else if (impl === 'flash') flash.current?.scrollToEnd({ animated });
        else void legend.current?.scrollToEnd({ animated });
      },
      scrollToIndex(index) {
        const params = { index, animated: false, viewPosition: 0 };
        if (impl === 'flat') flat.current?.scrollToIndex(params);
        else if (impl === 'flash') void flash.current?.scrollToIndex(params);
        else void legend.current?.scrollToIndex(params);
      },
      metrics: () => ({ ...measures.current }),
    }),
    [impl],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const m = measures.current;
    m.offset = contentOffset.y;
    m.contentHeight = contentSize.height;
    m.viewportHeight = layoutMeasurement.height;
    m.atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - END_THRESHOLD;
  }, []);

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      measures.current.contentHeight = height;
      // FlatList has no built-in stick-to-end; the other two do it natively.
      if (impl === 'flat' && measures.current.atEnd) flat.current?.scrollToEnd({ animated: false });
    },
    [impl],
  );

  const onLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    measures.current.viewportHeight = event.nativeEvent.layout.height;
  }, []);

  const renderItem = useCallback(({ item }: { item: ChatRow }) => renderRow(item), [renderRow]);
  const common = {
    data: rows as ChatRow[],
    keyExtractor,
    renderItem,
    extraData,
    onScroll,
    onContentSizeChange,
    onLayout,
    scrollEventThrottle: 16,
    contentContainerStyle: { paddingBottom: 24 },
  } as const;

  if (impl === 'flash') {
    return (
      <FlashList
        ref={flash}
        {...common}
        maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.2, startRenderingFromBottom: true }}
      />
    );
  }
  if (impl === 'legend') {
    return (
      <LegendList
        ref={legend}
        {...common}
        estimatedItemSize={96}
        recycleItems
        alignItemsAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
      />
    );
  }
  return (
    <FlatList
      ref={flat}
      {...common}
      initialNumToRender={12}
      windowSize={9}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onScrollToIndexFailed={({ averageItemLength, index }) =>
        flat.current?.scrollToOffset({ offset: averageItemLength * index, animated: false })
      }
    />
  );
});
