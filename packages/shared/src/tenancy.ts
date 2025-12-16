export interface TenancyModuleV1 {
  readonly version: 1;
  /**
   * Returns true if multi-tenant features are enabled by the proprietary module.
   * OSS core MUST treat false as strictly single-tenant.
   */
  isMultiTenantEnabled(): boolean;
  /**
   * Returns true if the OSS user limit should be bypassed (Enterprise license).
   * When false, OSS installations are limited to OSS_USER_LIMIT concurrent users.
   */
  bypassOssLimit?: () => boolean;
}

/** Default concurrent user limit for OSS self-hosted installations */
export const OSS_USER_LIMIT = 25;

export type TenancyModule = TenancyModuleV1;

