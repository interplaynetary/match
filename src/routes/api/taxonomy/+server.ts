import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTaxonomyData } from '$lib/server/state';

export const GET: RequestHandler = async () => {
	return json(getTaxonomyData());
};
