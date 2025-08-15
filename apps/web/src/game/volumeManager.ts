export type Point = { x: number; y: number };
export type Polygon = { name: string; points: Point[] };

export type VolumeRules = {
  nearRadius: number; // Distanz, bis zu der volle Lautstärke gilt
  farRadius: number;  // Distanz, ab der stumm gilt
  outsideBubbleAttenuation: number; // Lautstärke für Außen-vs-Bubble
};

export interface VolumeAV {
  setParticipantVolume: (sid: string, volume: number) => void;
}

export type Providers = {
  getLocal: () => { id: string; x: number; y: number } | null;
  getRemotes: () => Record<string, { x: number; y: number }>;
  getZones: () => Polygon[];
  getFollowTarget: () => string | null;
  getBubbleMembers: () => Set<string>;
};

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (((pi.y > p.y) !== (pj.y > p.y)) && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-9) + pi.x)) {
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
  bubbleMembers: Set<string>,
  rules: VolumeRules
): number {
  // Follow hat höchste Priorität
  if (followTarget && followTarget === remote.id) return 1;

  // Bubble-Regel dominiert über Zonen und Distanz
  const localInBubble = bubbleMembers.has(local.id);
  const remoteInBubble = bubbleMembers.has(remote.id);
  
  // Debug logging for bubble calculation
  if (bubbleMembers.size > 0) {
    console.log('[Volume] Bubble calculation:', {
      localId: local.id,
      remoteId: remote.id,
      localInBubble,
      remoteInBubble,
      bubbleMembers: Array.from(bubbleMembers)
    });
  }
  
  if (localInBubble && remoteInBubble) return 1;
  if (localInBubble && !remoteInBubble) return rules.outsideBubbleAttenuation;
  if (!localInBubble && remoteInBubble) return rules.outsideBubbleAttenuation;

  // Danach: gleiche Zone -> volle Lautstärke
  const localInAny = zones.find(z => pointInPolygon(local, z.points));
  const remoteInAny = zones.find(z => pointInPolygon(remote, z.points));
  if (localInAny && remoteInAny && localInAny.name === remoteInAny.name) return 1;

  // Distanzbasierte Abschwächung
  const dx = remote.x - local.x;
  const dy = remote.y - local.y;
  const d = Math.hypot(dx, dy);
  if (d <= rules.nearRadius) return 1;
  if (d >= rules.farRadius) return 0;
  const t = (d - rules.nearRadius) / Math.max(1, (rules.farRadius - rules.nearRadius));
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
      ...(rules || {})
    } as VolumeRules;
  }

  update(): Record<string, number> {
    const local = this.providers.getLocal();
    if (!local) return this.lastVolumes;
    const remotes = this.providers.getRemotes();
    const zones = this.providers.getZones();
    const followTarget = this.providers.getFollowTarget();
    const bubbleMembers = this.providers.getBubbleMembers();
    
    // Debug logging (commented out for production)
    // if (bubbleMembers.size > 0) {
    //   console.log('[VolumeManager] Update with bubble members:', Array.from(bubbleMembers));
    //   console.log('[VolumeManager] Local:', local.id);
    //   console.log('[VolumeManager] Remotes:', Object.keys(remotes));
    // }
    
    const volumes: Record<string, number> = {};
    
    for (const [sid, pos] of Object.entries(remotes)) {
      const vol = computePairVolume(local, { id: sid, x: pos.x, y: pos.y }, zones, followTarget, bubbleMembers, this.rules);
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


