import { z } from 'zod';

export const paintSchema = z
  .object({
    layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls', 'walls_auto']),
    rect: z.object({
      x0: z.number().int(),
      y0: z.number().int(),
      x1: z.number().int(),
      y1: z.number().int(),
    }),
    tileRefId: z.number().int().optional(),
    values: z.array(z.number().int()).optional(),
    erase: z.boolean().optional(),
    autotile: z
      .object({
        packUuid: z.string().uuid(),
        autotileId: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PaintRequest = z.infer<typeof paintSchema>;

export function validatePaintSemantics(paint: PaintRequest): string | null {
  const { layer, tileRefId, values, erase, autotile } = paint;
  if (paint.rect.x1 < paint.rect.x0 || paint.rect.y1 < paint.rect.y0) return 'invalid payload: invalid rectangle';
  if (layer === 'walls_auto' && (tileRefId !== undefined || (values && values.length > 0))) {
    return 'invalid payload: walls_auto requires an autotile identity';
  }
  if (layer !== 'walls_auto' && autotile) {
    return 'invalid payload: autotile identity is only valid for walls_auto';
  }
  if (!erase && layer === 'walls_auto' && !autotile) return 'invalid payload: missing autotile identity';
  if (!erase && layer !== 'walls_auto' && tileRefId === undefined && (!values || values.length === 0)) {
    return 'invalid payload: missing tileRefId or values';
  }
  const area = (paint.rect.x1 - paint.rect.x0 + 1) * (paint.rect.y1 - paint.rect.y0 + 1);
  if (values && values.length > 0 && values.length !== area)
    return 'invalid payload: values length does not match rectangle';
  return null;
}
