/**
 * Shared signup submission types for the registration wizard.
 *
 * The commercial (billing-enabled) path collects a B2B compliance block plus a
 * selected pricing tier; the pure-OSS path collects neither (OSS neutrality —
 * gated on `billingEnabled` from `GET /public/config`).
 */

/** AGB version the user accepts at signup. The authoritative legal text and its
 * versioning are a legal/ops concern; this constant is the machine-recorded tag
 * mirrored server-side (E6.9). */
export const CURRENT_AGB_VERSION = '2026-07-01';

export interface B2BSignupFields {
  companyLegalName: string;
  legalForm: string;
  billingCountry: string;
  /** Optional (Kleinunternehmer, E6.1); empty string when not provided. */
  vatId: string;
  /** Actively ticked entrepreneur declaration — never pre-checked (E6.1). */
  b2bDeclaration: boolean;
  agbVersion: string;
}

export interface TenantSignupSubmission {
  /** Selected commercial tier; null in pure-OSS mode. */
  tierKey: string | null;
  /** B2B evidence; present only when billing is enabled. */
  b2b: B2BSignupFields | null;
}
