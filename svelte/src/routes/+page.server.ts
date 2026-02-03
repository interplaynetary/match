import { getMatchData, getTaxonomyData } from '$lib/server/state';

export async function load() {
	return {
		matchData: getMatchData(),
		taxonomyTree: getTaxonomyData().tree
	};
}
