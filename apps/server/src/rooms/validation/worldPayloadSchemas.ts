import { z } from 'zod';

export const moveSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    direction: z.enum(['up', 'down', 'left', 'right']),
  })
  .strict();

export const dndSchema = z
  .object({
    dnd: z.boolean(),
  })
  .strict();
