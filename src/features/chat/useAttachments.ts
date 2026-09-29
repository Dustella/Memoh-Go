import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { t } from '../../core/i18n';
import { newId } from '../../core/ids';
import type { OutgoingAttachment } from '../../core/operations/outbox';
import { admitAttachments, formatLimit, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../../core/resources/attachments';
import { discardStaged, pickFiles, stageAttachments, type PickSource } from '../../platform/pickFiles';

/**
 * CH-16: files picked for the next message. They are copied into app
 * storage right away (the Outbox will point at the copies), shown as chips
 * above the input, and handed to send() together with the text.
 * Not persisted with the draft: leaving the chat drops unsent picks.
 */
export function useAttachments() {
  const [items, setItems] = useState<readonly OutgoingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback(async (source: PickSource) => {
    setBusy(true);
    try {
      const picked = await pickFiles(source);
      if (picked === 'denied') {
        Alert.alert(t('attach.cameraDenied'));
        return;
      }
      const { accepted, rejected } = admitAttachments(picked, itemsRef.current.length);
      if (rejected.length) {
        const tooLarge = rejected.filter((r) => r.reason === 'too_large').map((r) => r.name);
        Alert.alert(
          t('attach.rejectedTitle'),
          tooLarge.length
            ? t('attach.tooLarge', { names: tooLarge.join(', '), limit: formatLimit(MAX_ATTACHMENT_BYTES) })
            : t('attach.tooMany', { max: MAX_ATTACHMENTS }),
        );
      }
      if (!accepted.length) return;
      const staged = await stageAttachments(accepted, newId);
      setItems((prev) => [...prev, ...staged]);
    } catch (e) {
      Alert.alert(t('attach.pickFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback((index: number) => {
    const target = itemsRef.current[index];
    if (target) discardStaged([target]);
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** After send: the Outbox now owns the staged files. */
  const handOver = useCallback(() => {
    const list = itemsRef.current;
    setItems([]);
    return list;
  }, []);

  return { items, busy, add, remove, handOver };
}
