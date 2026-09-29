import { PlaceholderScreen } from '../../ui/components/PlaceholderScreen';
import { useT } from '../../ui/preferences';

export function ResourcesScreen() {
  const { t } = useT();
  return <PlaceholderScreen title={t('tabs.resources')} description={t('resources.description')} />;
}
