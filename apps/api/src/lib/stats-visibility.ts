import type { StatsVisibility } from '@voter/shared';

/** The booth breakdown switches saved on a constituency, as the API returns them. */
export function statsVisibilityOf(assembly: StatsVisibility): StatsVisibility {
  return {
    showGenderStats: assembly.showGenderStats,
    showReligionStats: assembly.showReligionStats,
    showCommunityStats: assembly.showCommunityStats,
  };
}
