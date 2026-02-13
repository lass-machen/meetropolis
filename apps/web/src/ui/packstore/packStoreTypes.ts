export type PricingModel = 'free' | 'one_time' | 'subscription';

export interface CatalogData {
  pricingModel: PricingModel;
  published: boolean;
  featured: boolean;
  stripeProductId: string | null;
  stripePriceId: string | null;
  priceAmountCents: number;
  priceCurrency: string;
  priceInterval: string | null;
  previewImageUrl: string | null;
  tags: string[];
}

export interface PackWithCatalog {
  id: number;
  uuid: string;
  name: string;
  author: string;
  version: string;
  description: string | null;
  catalog: CatalogData | null;
}

export interface PackAccess {
  grantSource: string;
  purchasedMajorVersion: number;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CatalogPack {
  uuid: string;
  name: string;
  author: string;
  version: string;
  packType: 'asset' | 'avatar';
  catalog: {
    pricingModel: PricingModel;
    priceAmountCents: number;
    priceCurrency: string;
    priceInterval: string | null;
    previewImageUrl: string | null;
    featured: boolean;
  };
  access: PackAccess | null;
}

export function formatPrice(cents: number, currency: string, interval: string | null): string {
  const amount = (cents / 100).toFixed(2);
  const sym = currency.toUpperCase() === 'EUR' ? '\u20AC' : currency.toUpperCase();
  if (interval) return `${amount} ${sym}/${interval}`;
  return `${amount} ${sym}`;
}

export function parseMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}
