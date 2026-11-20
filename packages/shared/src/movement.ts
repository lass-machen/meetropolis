export const WORLD_WALK_SPEED_PX_PER_SECOND = 80;

export interface MoveCorrectionMessage {
  x: number;
  y: number;
  mapId: string;
}
