export const accountingCategory = {
  id: 'category-1',
  name: 'Travel',
  code: 'TRV',
  default_tax_rate_id: 'tax-1',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-02T10:00:00Z',
};

export const accountingTaxRate = {
  id: 'tax-1',
  name: 'VAT 20',
  percentage: 20,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-02T10:00:00Z',
};

export const accountingLabelGroup = {
  id: 'group-1',
  name: 'Department',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-02T10:00:00Z',
};

export const accountingLabel = {
  id: 'label-1',
  name: 'Engineering',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-02T10:00:00Z',
};

export function accountingExpense(
  id = 'expense-1',
  state = 'approved',
  expenseDate = '2026-07-10T10:00:00Z',
) {
  return {
    id,
    state,
    transaction_type: 'card_payment',
    description: 'Team lunch',
    submitted_at: '2026-07-10T10:30:00Z',
    completed_at: state === 'approved' ? '2026-07-10T11:00:00Z' : undefined,
    payer: 'Private employee name',
    merchant: 'Cafe Example',
    transaction_id: `transaction-${id}`,
    expense_date: expenseDate,
    labels: { Department: ['Engineering'] },
    splits: [
      {
        amount: { amount: 25.5, currency: 'EUR' },
        category: { id: 'category-1', name: 'Meals', code: 'MEAL' },
        tax_rate: { id: 'tax-1', name: 'VAT 20', percentage: 20 },
      },
    ],
    receipt_ids: ['receipt-private-1'],
    spent_amount: { amount: 25.5, currency: 'EUR' },
  };
}
