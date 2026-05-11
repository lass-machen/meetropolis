export type Point = { x: number; y: number };
export type Polygon = { name: string; points: Array<Point | [number, number]> };

export type VolumeRules = {
  nearRadius: number; // Distance under which full volume applies.
  farRadius: number; // Distance at or beyond which audio is muted.
  outsideBubbleAttenuation: number; // Attenuation factor for outside-vs-bubble pairs.
  differentBubbleMute?: boolean; // When true, isolate different bubble groups fully (default: true).
};

export interface VolumeAV {
  setParticipantVolume: (sid: string, volume: number) => void;
}

export type Providers = {
  getLocal: () => { id: string; x: number; y: number } | null;
  getRemotes: () => Record<string, { x: number; y: number }>;
  getZones: () => Polygon[];
  getFollowTarget: () => string | null;
  // Map: colyseusId -> bubbleGroupId (same id means same bubble).
  getBubbleGroups: () => Record<string, string>;
  getLocalDnd?: () => boolean;
};

function pointInPolygon(p: Point, poly: Array<Point | [number, number]>): boolean {
  const pts: Point[] = [];
  for (const v of Array.isArray(poly) ? poly : []) {
    if (!v) continue;
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      pts.push({ x: v[0], y: v[1] });
    } else {
      const obj = v as Partial<Point> & { x?: unknown; y?: unknown };
      if (typeof obj.x === 'number' && typeof obj.y === 'number') {
        pts.push({ x: obj.x, y: obj.y });
      } else {
        const nx = Number(obj.x);
        const ny = Number(obj.y);
        if (!Number.isNaN(nx) && !Number.isNaN(ny)) pts.push({ x: nx, y: ny });
      }
    }
  }
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i],
      pj = pts[j];
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-9) + pi.x) {
      c = !c;
    }
  }
  return c;
}

export function computePairVolume(
  local: { id: string; x: number; y: number },
  remote: { id: string; x: number; y: number },
  zones: Polygon[],
  followTarget: string | null,
  bubbleGroups: Record<string, string> | Set<string>,
  rules: VolumeRules,
): number {
  // Follow always wins, even over zone rules.
  if (followTarget && followTarget === remote.id) {
    return 1;
  }

  // Resolve zone membership first to enforce per-zone audio isolation.
  const localZone = zones.find((z) => pointInPolygon(local, z.points));
  const remoteZone = zones.find((z) => pointInPolygon(remote, z.points));

  // One party in a zone and the other outside: mute.
  if ((localZone && !remoteZone) || (!localZone && remoteZone)) return 0;
  // Both in zones but different zones: mute.
  if (localZone && remoteZone && localZone.name !== remoteZone.name) return 0;

  // From here on the pair is audible: same zone or both outside any zone.

  // Bubble logic.
  // Legacy: Set<string> = "in bubble" (no group id available).
  // Current: Record<string, string> = participantId -> bubbleGroupId.
  if (bubbleGroups instanceof Set) {
    const localInBubble = bubbleGroups.has(local.id);
    const remoteInBubble = bubbleGroups.has(remote.id);
    if (localInBubble && remoteInBubble) return 1;
    if (localInBubble !== remoteInBubble) return rules.outsideBubbleAttenuation;
  } else {
    const localGroup = bubbleGroups[local.id] || '';
    const remoteGroup = bubbleGroups[remote.id] || '';
    const bothInBubble = !!localGroup && !!remoteGroup;
    if (bothInBubble) {
      if (localGroup === remoteGroup) return 1;
      // Isolate distinct bubbles within the same zone.
      return rules.differentBubbleMute === false ? rules.outsideBubbleAttenuation : 0;
    }
    // Exactly one party is in a bubble: attenuate but stay audible.
    if (!!localGroup !== !!remoteGroup) {
      return rules.outsideBubbleAttenuation;
    }
  }

  // Same zone with no bubble specifics: full volume regardless of distance.
  if (localZone && remoteZone && localZone.name === remoteZone.name) return 1;

  // Otherwise (both outside any zone): distance based attenuation.
  const dx = remote.x - local.x;
  const dy = remote.y - local.y;
  const d = Math.hypot(dx, dy);
  if (d <= rules.nearRadius) return 1;
  if (d >= rules.farRadius) return 0;
  const t = (d - rules.nearRadius) / Math.max(1, rules.farRadius - rules.nearRadius);
  return Math.max(0, Math.min(1, 1 - t));
}

export class VolumeManager {
  private av: VolumeAV;
  private providers: Providers;
  private rules: VolumeRules;
  private lastVolumes: Record<string, number> = {};

  constructor(av: VolumeAV, providers: Providers, rules?: Partial<VolumeRules>) {
    this.av = av;
    this.providers = providers;
    this.rules = {
      nearRadius: 96,
      farRadius: 384,
      outsideBubbleAttenuation: 0.2,
      differentBubbleMute: true,
      ...(rules || {}),
    };
  }

  update(): Record<string, number> {
    const local = this.providers.getLocal();
    if (!local) return this.lastVolumes;

    // If local user has DND, set all volumes to 0
    const localDnd = this.providers.getLocalDnd?.() || false;
    if (localDnd) {
      const remotes = this.providers.getRemotes();
      for (const sid of Object.keys(remotes)) {
        this.av.setParticipantVolume(sid, 0);
      }
      this.lastVolumes = {};
      return {};
    }

    const remotes = this.providers.getRemotes();
    const zones = this.providers.getZones();
    const followTarget = this.providers.getFollowTarget();
    const bubbleGroups = this.providers.getBubbleGroups();

    const volumes: Record<string, number> = {};

    for (const [sid, pos] of Object.entries(remotes)) {
      const vol = computePairVolume(
        local,
        { id: sid, x: pos.x, y: pos.y },
        zones,
        followTarget,
        bubbleGroups,
        this.rules,
      );
      this.av.setParticipantVolume(sid, vol);
      volumes[sid] = vol;
    }

    this.lastVolumes = volumes;
    return volumes;
  }

  getLastVolumes(): Record<string, number> {
    return this.lastVolumes;
  }
}
