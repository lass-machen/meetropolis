export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  concurrentLimit: number;
  freeSeats: number;
  bypassLimits: boolean;
  isInternal: boolean;
  createdAt: string;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member' | 'guest';
  expiresAt?: string | null;
}

export interface Guest {
  id: string; // membershipId
  email: string;
  name: string | null;
  expiresAt: string;
  createdAt: string;
}
