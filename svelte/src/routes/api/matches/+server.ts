import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateMatchData } from '$lib/core/match-data';

export const prerender = true;

export const GET: RequestHandler = async () => {
	return json(generateMatchData());
};
