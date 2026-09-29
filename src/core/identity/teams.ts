import { OSS_DEFAULT_TEAM_ID } from './credential';

/**
 * ID-05: which Teams the signed-in account can switch between.
 *
 * Memoh OSS is single-Team: every row is bound to one fixed Team through a
 * database session setting, and the HTTP API has no Team list, no switch
 * endpoint and no per-request Team selector (contracts/u2-auth.md, "Teams").
 * So the only real source today is `singleTeamDirectory`. A Cloud/multi-Team
 * server needs a contract for listing Teams and for selecting one per
 * request; until then the app implements the local half (scoped storage and
 * a clean switch) and hides the picker when there is only one Team.
 *
 * `mockTeamDirectory` is DEV-ONLY MOCK DATA (docs/HANDOFF.md, mock list): it
 * adds a fake second Team so the switch and the per-Team isolation can be
 * exercised on the dev stack. Requests still go to the same single-Team
 * server, so the mock Team shows the same Bots, cached under its own scope.
 */
export type TeamInfo = Readonly<{ id: string; name: string }>;

export type TeamListing = Readonly<{
  teams: readonly TeamInfo[];
  source: 'single' | 'mock';
}>;

export const MOCK_TEAM_ID = 'mock-team-b';

export function singleTeamDirectory(defaultName: string): TeamListing {
  return { teams: [{ id: OSS_DEFAULT_TEAM_ID, name: defaultName }], source: 'single' };
}

export function mockTeamDirectory(defaultName: string): TeamListing {
  return {
    teams: [
      { id: OSS_DEFAULT_TEAM_ID, name: defaultName },
      { id: MOCK_TEAM_ID, name: 'Research (mock)' },
    ],
    source: 'mock',
  };
}

/** Switching is offered only when there is somewhere to switch to. */
export const canSwitchTeams = (listing: TeamListing) => listing.teams.length > 1;
