import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { canSwitchTeams, mockTeamDirectory, singleTeamDirectory, type TeamInfo } from '../../core/identity/teams';
import { useT } from '../../ui/preferences';
import { spacing, useTheme } from '../../ui/theme';
import { styles as shared } from './ManagementScreen';

/**
 * ID-05: pick the Team this account works in. On a single-Team server (Memoh
 * OSS) there is one entry and nothing to switch. `mock` (dev builds only,
 * `memoh://team?mock=1`) adds a fake Team to exercise switching; see
 * core/identity/teams.ts.
 */
export function TeamScreen({ mock = false }: { mock?: boolean }) {
  const { colors } = useTheme();
  const { t } = useT();
  const { access } = useServices();
  const state = useAccessState();
  const [busy, setBusy] = useState(false);
  if (state.kind !== 'signed_in') return null;
  const current = state.session.connection.teamId;
  const listing = mock && __DEV__ ? mockTeamDirectory(t('management.teamDefault')) : singleTeamDirectory(t('management.teamDefault'));
  const switchable = canSwitchTeams(listing);

  const choose = (team: TeamInfo) => {
    if (team.id === current || busy) return;
    Alert.alert(t('team.switchConfirmTitle', { name: team.name }), t('team.switchConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('team.switch'),
        onPress: () => {
          setBusy(true);
          void access
            .switchTeam(team.id)
            .catch((e: unknown) => Alert.alert(t('team.switchFailed', { message: e instanceof Error ? e.message : String(e) })))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={shared.content}>
      {listing.source === 'mock' ? (
        <Text style={{ color: colors.warning, marginBottom: spacing.md }}>{t('team.mockNote')}</Text>
      ) : null}
      <View style={[shared.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {listing.teams.map((team, i) => {
          const selected = team.id === current;
          return (
            <Pressable
              key={team.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !switchable || busy }}
              disabled={!switchable || busy}
              onPress={() => choose(team)}
              style={({ pressed }) => [shared.row, i === 0 && { borderTopWidth: 0 }, { borderTopColor: colors.border }, pressed && shared.pressed]}
            >
              <Text style={[shared.rowLabel, { color: colors.text, flex: 1 }]}>{team.name}</Text>
              {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} accessibilityLabel={t('team.current')} /> : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
