export interface TenancyModuleV1 {
  readonly version: 1;
  /**
   * Returns true if multi-tenant features are enabled by the proprietary module.
   * OSS core MUST treat false as strictly single-tenant.
   */
  isMultiTenantEnabled(): boolean;
}

export type TenancyModule = TenancyModuleV1;

