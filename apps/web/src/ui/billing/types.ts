export interface Plan {
  id?: string;
  name: string;
  description?: string | null;
  amount: number;
  currency: string;
  interval: string;
  concurrentLimit: number;
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amount: number;
  currency: string;
  date: string | null;
  paidAt: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export interface BillingStatus {
  billing: {
    enabled: boolean;
    status: string;
    hasSubscription: boolean;
    subscription: Subscription | null;
    plan: Plan | null;
  };
  usage: {
    currentUsers: number;
    limit: number;
    freeSeats: number;
    paidSeats: number;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    bypassLimits: boolean;
    isInternal: boolean;
  };
}

export interface AvailablePlan {
  priceId: string;
  productId: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  interval: string;
  concurrentLimit: number;
  features: string[];
}

export interface PaymentStatus {
  status: 'ok' | 'failing' | 'grace_period' | 'suspended';
  failedAt: string | null;
  gracePeriodEndsAt: string | null;
  dunningStep: number;
  daysUntilCancellation: number | null;
}
