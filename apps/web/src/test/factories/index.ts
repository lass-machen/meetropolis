/**
 * Test Factories for Meetropolis
 *
 * Zentrale Mock-Factories für konsistente Testdaten.
 * Verwendung: import { createMockUser, createMockTenant } from '@/test/factories';
 */

// User Factory
export interface MockUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let userCounter = 0;

export function createMockUser(overrides?: Partial<MockUser>): MockUser {
  userCounter++;
  return {
    id: `user-${userCounter}`,
    email: `user${userCounter}@test.com`,
    name: `Test User ${userCounter}`,
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Tenant Factory
export interface MockTenant {
  id: string;
  slug: string;
  name: string;
  concurrentLimit: number;
  freeSeats: number;
  bypassLimits: boolean;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

let tenantCounter = 0;

export function createMockTenant(overrides?: Partial<MockTenant>): MockTenant {
  tenantCounter++;
  return {
    id: `tenant-${tenantCounter}`,
    slug: `test-tenant-${tenantCounter}`,
    name: `Test Tenant ${tenantCounter}`,
    concurrentLimit: 25,
    freeSeats: 5,
    bypassLimits: false,
    isInternal: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Membership Factory
export interface MockMembership {
  id: string;
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
}

let membershipCounter = 0;

export function createMockMembership(overrides?: Partial<MockMembership>): MockMembership {
  membershipCounter++;
  return {
    id: `membership-${membershipCounter}`,
    userId: `user-${membershipCounter}`,
    tenantId: `tenant-${membershipCounter}`,
    role: 'member',
    createdAt: new Date(),
    ...overrides
  };
}

// Player Factory (für Game-Tests)
export interface MockPlayer {
  id: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

let playerCounter = 0;

export function createMockPlayer(overrides?: Partial<MockPlayer>): MockPlayer {
  playerCounter++;
  return {
    id: `player-${playerCounter}`,
    x: Math.floor(Math.random() * 500) + 100,
    y: Math.floor(Math.random() * 500) + 100,
    direction: 'down',
    ...overrides
  };
}

// Room Factory
export interface MockRoom {
  id: string;
  name: string;
  mapId: string;
  createdAt: Date;
}

let roomCounter = 0;

export function createMockRoom(overrides?: Partial<MockRoom>): MockRoom {
  roomCounter++;
  return {
    id: `room-${roomCounter}`,
    name: `Test Room ${roomCounter}`,
    mapId: `map-${roomCounter}`,
    createdAt: new Date(),
    ...overrides
  };
}

// Zone Factory
export interface MockZone {
  id: string;
  name: string;
  capacity?: number;
  polygon: { x: number; y: number }[];
  roomId: string;
}

let zoneCounter = 0;

export function createMockZone(overrides?: Partial<MockZone>): MockZone {
  zoneCounter++;
  return {
    id: `zone-${zoneCounter}`,
    name: `Test Zone ${zoneCounter}`,
    capacity: 10,
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ],
    roomId: `room-${zoneCounter}`,
    ...overrides
  };
}

// Map Factory
export interface MockMap {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  width: number;
  height: number;
}

let mapCounter = 0;

export function createMockMap(overrides?: Partial<MockMap>): MockMap {
  mapCounter++;
  return {
    id: `map-${mapCounter}`,
    name: `Test Map ${mapCounter}`,
    tileWidth: 32,
    tileHeight: 32,
    width: 50,
    height: 50,
    ...overrides
  };
}

// Bubble Factory (Audio-Gruppen)
export interface MockBubble {
  id: string;
  members: string[];
  center: { x: number; y: number };
  radius: number;
}

let bubbleCounter = 0;

export function createMockBubble(overrides?: Partial<MockBubble>): MockBubble {
  bubbleCounter++;
  return {
    id: `bubble-${bubbleCounter}`,
    members: [],
    center: { x: 200, y: 200 },
    radius: 100,
    ...overrides
  };
}

// LiveKit Room Mock
export function createMockLiveKitRoom() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    state: 'connected',
    localParticipant: {
      identity: 'local-user',
      publishTrack: vi.fn().mockResolvedValue({}),
      unpublishTrack: vi.fn(),
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
      audioTrackPublications: new Map(),
      videoTrackPublications: new Map(),
    },
    remoteParticipants: new Map(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// Audio Track Mock
export function createMockAudioTrack(overrides?: Partial<{ id: string; muted: boolean }>) {
  return {
    id: overrides?.id || 'audio-track-1',
    kind: 'audio',
    muted: overrides?.muted ?? false,
    attach: vi.fn().mockReturnValue(document.createElement('audio')),
    detach: vi.fn(),
    stop: vi.fn(),
  };
}

// Video Track Mock
export function createMockVideoTrack(overrides?: Partial<{ id: string; muted: boolean }>) {
  return {
    id: overrides?.id || 'video-track-1',
    kind: 'video',
    muted: overrides?.muted ?? false,
    attach: vi.fn().mockReturnValue(document.createElement('video')),
    detach: vi.fn(),
    stop: vi.fn(),
  };
}

// Reset alle Counter (für Test-Isolation)
export function resetFactoryCounters() {
  userCounter = 0;
  tenantCounter = 0;
  membershipCounter = 0;
  playerCounter = 0;
  roomCounter = 0;
  zoneCounter = 0;
  mapCounter = 0;
  bubbleCounter = 0;
}

// Bulk-Factories
export function createMockUsers(count: number, overrides?: Partial<MockUser>): MockUser[] {
  return Array.from({ length: count }, () => createMockUser(overrides));
}

export function createMockPlayers(count: number, overrides?: Partial<MockPlayer>): MockPlayer[] {
  return Array.from({ length: count }, () => createMockPlayer(overrides));
}
