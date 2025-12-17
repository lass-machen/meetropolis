export type Point = { x: number; y: number };
export type Polygon = { name: string; points: Array<Point | [number, number]> };

export type VolumeRules = {
  nearRadius: number; // Distanz, bis zu der volle Lautstärke gilt
  farRadius: number;  // Distanz, ab der stumm gilt
  outsideBubbleAttenuation: number; // Lautstärke für Außen-vs-Bubble
  differentBubbleMute?: boolean; // Unterschiedliche Bubble-IDs vollständig trennen (default: true)
};

export interface VolumeAV {
  setParticipantVolume: (sid: string, volume: number) => void;
}

export type Providers = {
  getLocal: () => { id: string; x: number; y: number } | null;
  getRemotes: () => Record<string, { x: number; y: number }>;
  getZones: () => Polygon[];
  getFollowTarget: () => string | null;
  // Map: colyseusId -> bubbleGroupId (gleiche ID = gleiche Bubble)
  getBubbleGroups: () => Record<string, string>;
  getLocalDnd?: () => boolean;
};

function pointInPolygon(p: Point, poly: Array<Point | [number, number]>): boolean {
  const pts: Point[] = [];
  for (const v of Array.isArray(poly) ? poly : []) {
    if (!v) continue;
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      pts.push({ x: v[0], y: v[1] });
    } else if (typeof (v as any).x === 'number' && typeof (v as any).y === 'number') {
      pts.push({ x: (v as any).x, y: (v as any).y });
    } else {
      const nx = Number((v as any).x);
      const ny = Number((v as any).y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny)) pts.push({ x: nx, y: ny });
    }
  }
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i], pj = pts[j];
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
  bubbleGroups: Record<string, string> | Set<string>,
  rules: VolumeRules
): number {
  // Follow hat höchste Priorität (darf Zonenregeln außer Kraft setzen)
  if (followTarget && followTarget === remote.id) {
    return 1;
  }

  // Zuerst Zonen-Berechtigung bestimmen (Schallschutz zwischen Zonen)
  const localZone = zones.find(z => pointInPolygon(local, z.points));
  const remoteZone = zones.find(z => pointInPolygon(remote, z.points));

  // Wenn einer in einer Zone ist und der andere nicht: stumm
  if ((localZone && !remoteZone) || (!localZone && remoteZone)) return 0;
  // Wenn beide in Zonen, aber in unterschiedlichen: stumm
  if (localZone && remoteZone && localZone.name !== remoteZone.name) return 0;

  // Ab hier sind die beiden grundsätzlich hörbar:
  // - beide in derselben Zone, oder
  // - beide außerhalb aller Zonen

  // Bubble-Logik:
  // - Legacy: Set<string> = "in bubble" (keine Group-ID verfügbar)
  // - Current: Record<string, string> = participantId -> bubbleGroupId
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
      // Unterschiedliche Bubbles innerhalb derselben Zone isolieren
      return rules.differentBubbleMute === false ? rules.outsideBubbleAttenuation : 0;
    }
    // genau einer in Bubble → stark abschwächen (hörbar, aber deutlich)
    if (!!localGroup !== !!remoteGroup) {
      return rules.outsideBubbleAttenuation;
    }
  }

  // Wenn in derselben Zone und keine Bubble-Sonderfälle: volle Lautstärke (distanzunabhängig)
  if (localZone && remoteZone && localZone.name === remoteZone.name) return 1;

  // Andernfalls: beide außerhalb von Zonen → Distanzbasierte Abschwächung
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
      differentBubbleMute: true,
      ...(rules || {})
    } as VolumeRules;
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
      const vol = computePairVolume(local, { id: sid, x: pos.x, y: pos.y }, zones, followTarget, bubbleGroups, this.rules);
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

