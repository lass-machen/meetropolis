// Shared types for the UserManagement feature. Extracted to keep the orchestrator
// and its sibling components/hooks under the per-file LoC budget.

export type Role = 'owner' | 'admin' | 'member';
export type User = { id: string; email: string; name?: string; createdAt?: string; role?: Role };
export type EditUser = { id: string; email: string; name?: string; role?: Role | undefined };

export interface MeResponse {
  id: string;
}

export interface ApiErrorBody {
  error?: string;
}

export interface ResetTokenResponse {
  token?: string | null;
  resetUrl?: string | null;
}

export interface InviteResponse {
  code?: string | null;
}

export interface UserManagementWindow {
  __userManagementLoad?: () => Promise<void>;
}
