export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
};
