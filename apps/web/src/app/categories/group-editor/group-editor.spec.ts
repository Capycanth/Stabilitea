import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { GroupDto } from '@stabilitea/shared';
import { GroupEditor } from './group-editor';

const housing: GroupDto = { id: 2, name: 'Housing', kind: 'expense', sortOrder: 1, archivedAt: null, categories: [] };

describe('GroupEditor add-category form', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(group = housing) {
    const fixture = TestBed.createComponent(GroupEditor);
    fixture.componentRef.setInput('group', group);
    fixture.componentRef.setInput('index', 0);
    fixture.componentRef.setInput('count', 1);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const type = () => el.querySelector<HTMLSelectElement>('#new-category-type');
    const setValue = async (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
    };
    const submit = async () => {
      el.querySelector<HTMLButtonElement>('form.category-form button[type="submit"]')!.click();
      await fixture.whenStable();
    };
    return { fixture, el, type, setValue, submit };
  }

  it('defaults to Standard and offers Fund and Recurring', async () => {
    const { el, type } = await render();
    expect(type()?.value).toBe('standard');
    expect([...type()!.options].map((o) => o.textContent?.trim())).toEqual(['Standard', 'Fund', 'Recurring']);
    expect(el.querySelector('#new-category-bill')).toBeNull();
    expect(el.querySelector('#new-category-limit')).not.toBeNull();
  });

  it('asks for the bill when Recurring is chosen and sends it', async () => {
    const { el, setValue, submit } = await render();
    await setValue('#new-category-name', 'Insurance');
    await setValue('#new-category-type', 'recurring');
    expect(el.querySelector('#new-category-bill')).not.toBeNull();
    expect(el.querySelector('#new-category-limit')).toBeNull();

    await submit();
    http.expectNone('/api/groups/2/categories');
    expect(el.textContent).toContain('Enter the bill amount');
    expect(el.textContent).toContain('Choose the month the bill is next due');

    await setValue('#new-category-bill', '387.33');
    await setValue('#new-category-months', '2');
    await setValue('#new-category-due', '2026-12');
    expect(el.textContent).toContain('About $193.67 a month');

    await submit();
    const req = http.expectOne('/api/groups/2/categories');
    expect(req.request.body).toEqual({
      name: 'Insurance',
      defaultLimitCents: 0,
      type: 'recurring',
      billCents: 38_733,
      billMonths: 2,
      nextDueMonth: '2026-12',
    });
    req.flush({});
  });

  it('has no type choice for income groups', async () => {
    const { type } = await render({ ...housing, kind: 'income', name: 'Income' });
    expect(type()).toBeNull();
  });
});
