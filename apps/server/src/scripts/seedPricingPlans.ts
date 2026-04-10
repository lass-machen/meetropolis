import { PrismaClient } from '../generated/prisma/index.js';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.pricingPlan.count();
  if (existing > 0) {
    console.log('Pricing plans already exist, skipping seed.');
    return;
  }

  await prisma.pricingPlan.createMany({
    data: [
      {
        name: { en: 'Starter', de: 'Starter' },
        priceAmount: 500,
        priceCurrency: 'EUR',
        priceInterval: 'month',
        unitLabel: { en: 'user / month', de: 'Nutzer / Monat' },
        features: [
          { en: 'Up to 25 users', de: 'Bis zu 25 Nutzer' },
          { en: 'Spatial Audio & Video', de: 'Spatial Audio & Video' },
          { en: 'Screen Sharing', de: 'Bildschirmfreigabe' },
          { en: '1 Custom Map', de: '1 eigene Map' },
        ],
        ctaLabel: { en: 'Start 14-Day Free Trial', de: '14 Tage kostenlos testen' },
        highlighted: false,
        customPricing: false,
        sortOrder: 0,
        visible: true,
      },
      {
        name: { en: 'Team', de: 'Team' },
        priceAmount: 900,
        priceCurrency: 'EUR',
        priceInterval: 'month',
        unitLabel: { en: 'user / month', de: 'Nutzer / Monat' },
        features: [
          { en: 'Up to 100 users', de: 'Bis zu 100 Nutzer' },
          { en: 'Everything in Starter', de: 'Alles aus Starter' },
          { en: 'Unlimited Maps', de: 'Unbegrenzte Maps' },
          { en: 'Guest Access & Roles', de: 'Gastzugang & Rollen' },
        ],
        ctaLabel: { en: 'Start 14-Day Free Trial', de: '14 Tage kostenlos testen' },
        highlighted: true,
        badgeLabel: { en: 'Popular', de: 'Beliebt' },
        customPricing: false,
        sortOrder: 1,
        visible: true,
      },
      {
        name: { en: 'Enterprise', de: 'Enterprise' },
        customPricing: true,
        priceLabel: { en: 'Custom', de: 'Individuell' },
        features: [
          { en: 'Unlimited users', de: 'Unbegrenzte Nutzer' },
          { en: 'Everything in Team', de: 'Alles aus Team' },
          { en: 'Dedicated Support', de: 'Dedizierter Support' },
          { en: 'SSO & Custom Branding', de: 'SSO & Custom Branding' },
        ],
        ctaLabel: { en: 'Contact Us', de: 'Kontaktieren Sie uns' },
        highlighted: false,
        sortOrder: 2,
        visible: true,
      },
    ],
  });

  console.log('Seeded 3 pricing plans successfully.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
