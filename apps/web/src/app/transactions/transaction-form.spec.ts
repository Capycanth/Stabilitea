import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { ApiErrorBody, CategoryDto, TransactionDto } from '@stabilitea/shared';
import { TransactionForm } from './transaction-form';

const categories: CategoryDto[] = [
  {
    id: 1,
    name: 'Income',
    kind: 'income',
    sortOrder: 0,
    archivedAt: null,
    subcategories: [{ id: 10, categoryId: 1, name: 'Salary', defaultLimitCents: 0, fund: false, sortOrder: 0, archivedAt: null, transactionCount: 0 }],
  },
  {
    id: 2,
    name: 'Food',
    kind: 'expense',
    sortOrder: 1,
    archivedAt: null,
    subcategories: [{ id: 20, categoryId: 2, name: 'Groceries', defaultLimitCents: 50_000, fund: false, sortOrder: 0, archivedAt: null, transactionCount: 0 }],
  },
];

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('TransactionForm', () => {
  let fixture: ComponentFixture<TransactionForm>;
  let el: HTMLElement;
  let http: HttpTestingController;

  const input = (selector: string) => el.querySelector(selector) as HTMLInputElement;
  const type = (selector: string, value: string) => {
    const field = input(selector);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur'));
  };
  const submit = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    fixture.detectChanges();
  };
  const errors = () => [...el.querySelectorAll('.field-error')].map((e) => e.textContent?.trim());

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransactionForm);
    fixture.componentRef.setInput('month', '2026-08');
    fixture.componentRef.setInput('categories', categories);
    await fixture.whenStable();
    el = fixture.nativeElement;
    fixture.componentInstance.open();
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('opens a dialog defaulting to the first day of a past month', () => {
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(input('#tx-date').value).toBe('2026-08-01');
  });

  it('requires an amount and a category before saving', async () => {
    await submit();
    expect(errors()).toEqual(['Enter an amount', 'Choose a category']);
    http.expectNone('/api/transactions');
    expect(input('#tx-amount').getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('.field-error')?.getAttribute('role')).toBe('alert');
  });

  it('rejects malformed and zero amounts', async () => {
    type('#tx-amount', '12.345');
    await fixture.whenStable();
    expect(errors()).toContain('Enter a dollar amount like 12.50');

    type('#tx-amount', '0');
    await fixture.whenStable();
    expect(errors()).toContain('Amount must be greater than 0');
  });

  it('converts dollars to cents and infers the type from the category', async () => {
    const saved: TransactionDto[] = [];
    fixture.componentInstance.saved.subscribe((tx) => saved.push(tx));

    type('#tx-amount', '42.5');
    type('#tx-subcategory', '20');
    type('#tx-payee', '  Corner Bakery ');
    await fixture.whenStable();
    expect(el.textContent).toContain('Recorded as an expense.');

    await submit();
    const req = http.expectOne('/api/transactions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      date: '2026-08-01',
      type: 'expense',
      amountCents: 4250,
      subcategoryId: 20,
      payee: 'Corner Bakery',
      note: null,
    });
    req.flush({ id: 1, ...req.request.body, subcategoryName: 'Groceries', categoryId: 2, categoryName: 'Food' });
    await fixture.whenStable();

    expect(saved).toHaveLength(1);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('maps server field errors onto the form', async () => {
    type('#tx-amount', '10');
    type('#tx-subcategory', '10');
    await submit();

    const body: ApiErrorBody = {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      fieldErrors: { date: ['Date must be a valid YYYY-MM-DD date'] },
    };
    http.expectOne('/api/transactions').flush(body, { status: 400, statusText: 'Bad Request' });
    await tick();
    await fixture.whenStable();

    expect(errors()).toContain('Date must be a valid YYYY-MM-DD date');
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  });

  it('explains when the month is closed', async () => {
    type('#tx-amount', '10');
    type('#tx-subcategory', '20');
    await submit();
    http
      .expectOne('/api/transactions')
      .flush({ statusCode: 409, code: 'MONTH_CLOSED', message: 'closed' }, { status: 409, statusText: 'Conflict' });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('.form-error')?.textContent).toContain('August 2026 is closed');
  });
});
