import { z } from 'zod';

export const NanoId = z.string().min(10).max(32);
export type NanoId = z.infer<typeof NanoId>;
