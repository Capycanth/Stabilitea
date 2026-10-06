# Angular Best Practices for Claude Agents

> **Snapshot date:** September 16, 2026
> **Current stable:** Angular **v22.1.x** (22.1.6 released Sep 9, 2026). v22.2 is in pre-release (`22.2.0-next.x`).
> **Supported majors:** v22 (active), v21 and v20 (security/LTS only). v19 and older are end-of-life.
> **Toolchain for v22:** TypeScript **6.x** required (5.9 unsupported). Node 20 dropped; Node 22+ (Node 26 supported).
> **Release cadence change:** Starting with v23, majors ship **once a year in June** (v23 → June 2027), each supported for 2 years. Minors ship roughly every two months.

Drop this file into a repo as `CLAUDE.md` (or reference it from one), or package it as a skill under `.claude/skills/angular/SKILL.md`. It is written as direct instructions to a coding agent.

---

## 0. Agent operating rules (read first)

1. **Detect the version before writing any code.** Read `@angular/core` in `package.json` (or run `ng version`). Many rules below are version-gated — follow the gate, not the newest API, when the project is older.
2. **Match the codebase.** If an existing file or feature uses a different (still valid) pattern, stay consistent within that file/feature. Propose modernization separately; don't mix styles in one file.
3. **Scaffold with the CLI**: `ng generate component|service|directive|pipe|guard|interceptor ...`. This gives correct naming, file layout, and current defaults.
4. **Prefer official migrations over hand-rewrites**: `ng update @angular/core @angular/cli` and `ng generate @angular/core:<migration>` (e.g. `control-flow`, `signal-inputs`, `inject`, `service`).
5. **Verify every change**: run `ng build` and fix all errors; run `ng test` for touched areas. Don't report a task done with a failing build.
6. **Never invent APIs.** If unsure an API exists in the detected version, check `https://angular.dev` (or `https://angular.dev/llms.txt`) before using it.
7. **Use Angular's AI tooling when available:**
   - Official skills: `npx skills add https://github.com/angular/skills` (`angular-developer`, `angular-new-app`).
   - CLI MCP server: `npx -y @angular/cli mcp` (e.g. `claude mcp add angular-cli -- npx -y @angular/cli mcp`). In v22.1, `run_target` and the `devserver.start` / `devserver.stop` / `devserver.wait_for_build` tools are stable.
8. **New projects:** don't pin a version unless asked. Use `ng new` if the CLI is installed, otherwise `npx @angular/cli@latest new <name>`.

---

## 1. Version-gated feature map

| Feature | Available | Default / status |
|---|---|---|
| Standalone components | v14+ | Default v19+ (never write `standalone: true`) |
| Built-in control flow (`@if`, `@for`, `@switch`, `@defer`) | v17+ | Preferred over `*ngIf`/`*ngFor` |
| `input()`, `output()`, `model()`, signal queries | v17.1–v17.3+ | Stable v19+ |
| `linkedSignal()` | v19+ | Stable v20; custom `set` option v22.1 |
| `provideZonelessChangeDetection()` | v18 exp. | Stable v20.2; **zoneless by default for new apps in v21** |
| Native `animate.enter` / `animate.leave` | v20.2+ | Legacy `@angular/animations` DSL deprecated |
| Vitest unit testing | v20 exp. | **Default test runner for new apps in v21** |
| `HttpClient` provided in root (no `provideHttpClient()` needed) | v21+ | Only call it to customize |
| Arrow functions in templates, `@default never` | v21.2+ | Nested discriminants via `@default never(x)` in v22 |
| **Signal Forms** (`@angular/forms/signals`) | v21 exp. | **Stable v22** |
| **`resource()`, `rxResource()`, `httpResource()`** | v19/v20 exp. | **Stable v22** |
| **OnPush as default change detection** | — | **v22** (`Default` renamed `Eager`) |
| **`@Service()` decorator**, `injectAsync()` | — | v22 (CLI generates `@Service()` by default) |
| Fetch-based HttpClient by default | — | v22 (`withFetch()` deprecated; `withXhr()` to opt out) |
| `strictTemplates` on by default | — | v22 |
| Incremental hydration by default | v19 | Default v22 |
| Angular Aria (`@angular/aria`) | v21 preview | Stable v22 |
| `debounced()` signal utility | v22 | Experimental |
| WebMCP APIs (`declareExperimentalWebMcpTool`, etc.) | v22 | Experimental — don't use unless asked |

---

## 2. TypeScript

- Keep `strict` on. Don't loosen compiler or template strictness to make an error go away.
- Never use `any`. Use `unknown` and narrow, or model the type properly.
- Rely on inference when the type is obvious; annotate public APIs and function returns that aren't obvious.
- Use discriminated unions for state (`{ status: 'loading' } | { status: 'ok'; data: T } | ...`) and exhaustive `@switch` in templates.

---

## 3. Components

**Do**
- Use standalone components; import exactly the directives/pipes/components the template uses.
- Use signal APIs: `input()`, `input.required()`, `output()`, `model()`, `viewChild()`, `contentChildren()`, etc.
- Mark Angular-initialized members `readonly` (inputs, outputs, models, queries).
- Mark template-only members `protected`; keep `public` for true component API.
- Put host bindings/listeners in the decorator's `host` object.
- Use `class` / `style` bindings (`[class.active]="isActive()"`, `[style.width.px]="w()"`).
- Keep components small and presentation-focused; move business logic to services or pure functions.
- Group injected deps, inputs, outputs, and queries at the top of the class, before methods.
- Name event handlers for what they do (`saveUser()`), not the trigger (`onClick()`).
- Prefer inline templates for small components; use paths relative to the TS file for external ones.
- Use `NgOptimizedImage` (`ngSrc`) for static images (not for inline base64).

**Don't**
- ❌ `standalone: true` (it's the default).
- ❌ `@Input()`, `@Output()`, `@ViewChild()` decorators in new code.
- ❌ `@HostBinding` / `@HostListener`.
- ❌ `ngClass` / `ngStyle`, or importing `CommonModule`.
- ❌ Constructor injection in new code (use `inject()`).
- ❌ Heavy logic in `ngOnInit` — call well-named methods instead.

**Change detection**
- **v22+:** OnPush is the default. **Do not** add `changeDetection: ChangeDetectionStrategy.OnPush`. Only write `ChangeDetectionStrategy.Eager` when a component truly needs it (usually legacy code).
- **v21 and below:** explicitly set `ChangeDetectionStrategy.OnPush` on new components.
- Design for zoneless: state that drives the view should be signals (or go through the `async` pipe). Don't depend on Zone.js to notice mutations, and never use `setTimeout` to "force" a refresh.

**File naming (current style guide)**
- Hyphenated, no type suffix: `UserProfile` → `user-profile.ts`, `user-profile.html`, `user-profile.css`, `user-profile.spec.ts`.
- Organize by feature (`src/app/checkout/payment-info/`), not by type (`components/`, `services/`).
- One concept per file; avoid `utils.ts` / `helpers.ts` dumping grounds.

```ts
import { Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-user-card',
  host: { class: 'user-card', '[class.selected]': 'selected()' },
  template: `
    <h2>{{ fullName() }}</h2>
    <button type="button" (click)="selectUser()">Select</button>
  `,
})
export class UserCard {
  readonly firstName = input.required<string>();
  readonly lastName = input.required<string>();
  readonly selected = input(false);
  readonly userSelected = output<void>();

  protected readonly fullName = computed(() => `${this.firstName()} ${this.lastName()}`);

  protected selectUser() {
    this.userSelected.emit();
  }
}
```

---

## 4. Templates

- Use `@if` / `@else`, `@for` (always with a meaningful `track`, e.g. `track item.id`), `@switch`, `@let`.
- Use `@empty` for empty lists and exhaustive `@switch` with `@default never;` (v21.2+) for union types.
- Keep expressions simple; move anything non-trivial into a `computed()`.
- Arrow functions are allowed in templates (v21.2+) for simple updates like `count.update(n => n + 1)`, but not as wrappers to call methods in event bindings.
- Don't assume globals (e.g. `new Date()`, `window`) are available in templates.
- v22 template notes: comments are allowed inside element tags; `?.` now returns `undefined` (TypeScript semantics) — remove unnecessary `?.` guards inside narrowing `@if` blocks; review any `$safeNavigationMigration()` wrappers left by `ng update`.
- Use `@defer` to lazy-load heavy, below-the-fold, or interaction-gated UI, with `@placeholder` / `@loading` / `@error`. `on idle(500ms)` sets a max idle wait (v22).

---

## 5. Signals & reactivity

- `signal()` for local writable state; `computed()` for derived state.
- `linkedSignal()` for writable state that resets when a source changes (e.g., selected item that resets when the list changes).
- Update with `.set()` / `.update()`; treat values as immutable (no in-place mutation; `mutate` no longer exists).
- `effect()` is for **side effects only** (logging, syncing to `localStorage`, third-party libs). Never use an effect to copy one signal into another — use `computed` / `linkedSignal`.
- Wrap non-dependency work inside effects with `untracked()`.
- Use `afterRenderEffect()` / `afterNextRender()` for DOM measurement or manipulation.
- RxJS interop: `toSignal()` / `toObservable()` from `@angular/core/rxjs-interop`; `takeUntilDestroyed()` for any manual subscription.
- `debounced(source, ms)` (v22, experimental) returns a `Resource`, not a signal — read `.value()` and `.isLoading()`.

---

## 6. Async data: resources (stable in v22)

Prefer resources over hand-rolled `subscribe` + loading flags.

```ts
// Simple GET driven by signals
protected readonly user = httpResource<User>(() => `/api/users/${this.userId()}`);

// Promise-based
protected readonly report = resource({
  params: () => ({ id: this.reportId() }),        // return undefined to stay idle
  loader: ({ params, abortSignal }) =>
    fetch(`/api/reports/${params.id}`, { signal: abortSignal }).then(r => r.json()),
});

// Observable-based
protected readonly orders = rxResource({
  params: () => this.customerId(),
  stream: ({ params }) => this.orderApi.list(params),
});
```

- In templates, gate on state: `@if (user.hasValue()) { ... }`, `@if (user.isLoading())`, `@if (user.error())`.
- Chain dependent resources with `chain()` in the params/request function (v22) so loading/error state propagates.
- For SSR, give `resource` / `rxResource` an `id` to reuse server-fetched data on the client (v22).
- Resources are for **reads**. Do mutations (POST/PUT/DELETE) with `HttpClient` methods, then `.reload()` or update local state.

---

## 7. HTTP

- v21+: `HttpClient` is injectable without `provideHttpClient()`; add it only to configure (e.g. `withInterceptors`).
- v22: Fetch backend is the default. Remove `withFetch()`; use `withXhr()` only if you need upload progress. Use `reportUploadProgress` / `reportDownloadProgress` instead of deprecated `reportProgress`.
- Use **functional interceptors** (`HttpInterceptorFn`) with `withInterceptors([...])`.
- Wrap endpoints in typed services; don't call `HttpClient` directly from components.
- JSONP is deprecated (v22.1) — don't use `withJsonpSupport()`.

---

## 8. Dependency injection & services

- Always `inject()` instead of constructor parameters.
- **v22+:** new app-wide singletons use `@Service()` (equivalent to root-provided `@Injectable`). `@Service()` classes must use `inject()`. Use `@Service({ autoProvided: false })` when you'll provide it manually. Migrate with `ng generate @angular/core:service` (v22.1).
- **v21 and below:** `@Injectable({ providedIn: 'root' })`.
- One responsibility per service. Use `InjectionToken` for config values and non-class dependencies.
- Scope feature-only services with route `providers` or component `providers`, not root.
- `injectAsync(() => import('./heavy.service'))` (v22) to lazy-load rarely used, heavy services; it must be called in an injection context.

```ts
import { Service, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Service()
export class CartStore {
  private readonly http = inject(HttpClient);
  private readonly items = signal<CartItem[]>([]);

  readonly count = computed(() => this.items().length);

  add(item: CartItem) {
    this.items.update(list => [...list, item]);
  }
}
```

---

## 9. State management

- Default: signals in components + signal-based services ("signal stores") for shared state. Expose read-only state (`asReadonly()` or `computed`) and mutate through methods.
- Reach for NgRx SignalStore / NgRx Store only when the project already uses it or the complexity clearly warrants it. Follow the project's existing choice.
- Keep state transformations pure and predictable.

---

## 10. Forms

**Decision rule**
- New form in a v22+ project → **Signal Forms** (stable).
- New form in v21 → Signal Forms are experimental; use them only if the project already does, otherwise typed Reactive Forms.
- Existing forms → keep the form technology already used; don't mix Signal and Reactive APIs inside one form.
- Prefer Reactive over Template-driven when not using Signal Forms.

**Signal Forms essentials (v22)**

```ts
import { Component, signal } from '@angular/core';
import { form, FormField, required, email, minLength } from '@angular/forms/signals';

@Component({
  selector: 'app-signup',
  imports: [FormField],
  template: `
    <label for="email">Email</label>
    <input id="email" type="email" [formField]="signupForm.email" />
    @let emailField = signupForm.email();
    @if (emailField.touched() && emailField.getError('required')) {
      <p role="alert">Email is required</p>
    }
  `,
})
export class Signup {
  private readonly model = signal({ email: '', password: '' });

  protected readonly signupForm = form(this.model, f => {
    required(f.email);
    email(f.email);
    required(f.password);
    minLength(f.password, 12);
  });
}
```

- Bind with `[formField]` (the old `[field]` directive was removed in v21.1).
- Conditional rules use the `when` option: `disabled(f.age, { when: ({ valueOf }) => ... })`.
- Use `getError('kind')` for typed error access; `minDate()` / `maxDate()` for dates; `debounce(f.x, ms | 'blur')`; `validateHttp(..., { debounce })` for async validation; `reloadValidation()` to re-run async validators.
- `markAsTouched()` now touches descendants too (v22).
- Build custom controls with `FormValueControl` (works with Signal, Reactive, and template-driven forms in v22). Custom controls now expose a `touched` input and `touch()` output.
- Hide fields in the template with `@if` when the schema marks them `hidden`.

---

## 11. Routing

- Lazy-load features: `loadComponent: () => import('./x')` and `loadChildren: () => import('./x.routes')`.
- Functional guards and resolvers (`CanActivateFn`, `CanMatchFn`, `ResolveFn`) using `inject()`. v22: `canMatch` functions receive a third `currentSnapshot` argument.
- Bind route params to inputs with `withComponentInputBinding()` (v22 accepts options like `queryParams` and `unmatchedInputBehavior`).
- v22 default `paramsInheritanceStrategy` is `'always'` — set `'emptyOnly'` explicitly if a project relies on the old behavior (no automatic migration).
- Use route-level `providers` for feature-scoped services.
- Consider `withViewTransitions()` for route animations.

---

## 12. SSR & hydration

- Never touch `window`, `document`, `localStorage` directly in shared code. Use `inject(DOCUMENT)`, `afterNextRender()`, or platform checks.
- v22: incremental hydration is the default (drop `withIncrementalHydration()`). Use `@defer (hydrate on viewport | interaction | idle)` to defer hydration.
- Choose render mode per route (server, client, prerender) in server routes config.
- Cache resource data across server→client with resource `id`s; use `TransferState` otherwise.

---

## 13. Styling & animations

- Keep default emulated encapsulation. Avoid `::ng-deep`; expose styling hooks via CSS custom properties or host classes.
- Use `:host` for host element styles.
- Tailwind: set up with the CLI's Tailwind support rather than manual config.
- Animations: use native CSS with `animate.enter` / `animate.leave` (v20.2+). Don't add new `@angular/animations` DSL code.

---

## 14. Accessibility (non-negotiable)

- Must pass AXE checks and meet WCAG 2.x AA: labels on every control, visible focus, correct focus management for dialogs/route changes, color contrast, keyboard operability.
- Use native elements first (`<button>`, `<a href>`, `<dialog>`).
- v22+: build complex widgets (Accordion, Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid) on `@angular/aria` headless patterns instead of hand-rolled ARIA.
- Use `role="alert"` / live regions for validation and async status messages.

---

## 15. Testing

- **Runner:** Vitest (default for new apps since v21). For Karma projects on v22: `ng g @angular/cli:migrate-karma-to-vitest`, then `ng g refactor-jasmine-vitest` (supports `--fake-async`). Follow whatever runner the project currently uses.
- Test behavior through the DOM and public API, not private members.
- Zoneless-friendly async: `await fixture.whenStable()`; prefer Vitest fake timers (`vi.useFakeTimers()`, `vi.advanceTimersByTimeAsync()`) over `fakeAsync` in new tests.
- Set signal inputs via `fixture.componentRef.setInput('name', value)` (or TestBed bindings).
- Use component harnesses (CDK / Material) for interacting with library components; `RouterTestingHarness` for routing.
- Mock HTTP with `provideHttpClientTesting()` + `HttpTestingController`.
- `TestBed.getLastFixture()` (v22) is available for fixtures created in `beforeEach`.
- Don't write tests that assert on implementation details or snapshot entire templates.

---

## 16. Security

- Trust Angular's built-in sanitization. Never use `bypassSecurityTrust*` on user-controlled data.
- Don't build HTML strings or use `innerHTML` with untrusted content; avoid direct DOM APIs (`ElementRef.nativeElement.innerHTML`).
- No JSONP. Keep secrets out of the frontend bundle and `environment` files.
- Support a strict CSP; consider the `subresourceIntegrity` build option.

---

## 17. Performance

- Lazy-load routes; `@defer` heavy UI; `injectAsync` heavy services.
- `track` by stable IDs in `@for`.
- Derive with `computed()` instead of methods called from templates.
- `NgOptimizedImage` with explicit sizes; `priority` for LCP images.
- Respect bundle budgets in `angular.json`; don't raise budgets to silence warnings without justification.

---

## 18. Legacy → modern cheat sheet

| Avoid (legacy) | Use (modern) |
|---|---|
| `NgModule` for new features | Standalone components + `imports` |
| `standalone: true` | Omit it |
| `*ngIf`, `*ngFor`, `*ngSwitch` | `@if`, `@for (...; track ...)`, `@switch` |
| `@Input()` / `@Output()` / `EventEmitter` | `input()` / `output()` / `model()` |
| `@ViewChild()` / `@ContentChildren()` | `viewChild()` / `contentChildren()` |
| `@HostBinding` / `@HostListener` | `host: { ... }` |
| `[ngClass]` / `[ngStyle]` | `[class.x]` / `[style.x]` / `[class]` |
| `CommonModule` import | Import individual pipes/directives |
| Constructor injection | `inject()` |
| `@Injectable({ providedIn: 'root' })` (v22+) | `@Service()` |
| `changeDetection: OnPush` (v22+) | Omit (default) |
| `ChangeDetectionStrategy.Default` | `ChangeDetectionStrategy.Eager` (only if truly needed) |
| `BehaviorSubject` for local state | `signal()` / `computed()` |
| `subscribe` + loading flags for reads | `httpResource` / `resource` / `rxResource` |
| Class-based guards/resolvers/interceptors | Functional versions |
| `withFetch()` (v22+) | Omit (default) |
| `withIncrementalHydration()` (v22+) | Omit (default) |
| `[field]` in Signal Forms | `[formField]` |
| `@angular/animations` triggers | `animate.enter` / `animate.leave` + CSS |
| Karma + Jasmine (new work) | Vitest |
| `user-profile.component.ts` naming | `user-profile.ts` |

---

## 19. Upgrading v21 → v22: watch-outs

- Upgrade TypeScript to 6 and Node to 22+ first.
- `ng update` adds `ChangeDetectionStrategy.Eager` to components without a strategy, `strictTemplates: false` if it wasn't enabled, `withXhr()` where `withFetch()` was absent, and `withNoIncrementalHydration()` where applicable. Plan follow-up work to remove these opt-outs deliberately.
- Review `$safeNavigationMigration()` wrappers in templates.
- Router: `paramsInheritanceStrategy` now `'always'` — no automatic migration.
- Signal Forms (if used experimentally): `touched` model → `touched` input + `touch()` output (manual); validators move to the `when` option.
- Compiler now errors on multiple components matching one element and on duplicate input/output/model names.

---

## 20. Definition of done (agent checklist)

- [ ] Checked Angular version and followed version-gated rules.
- [ ] Used CLI generators and project conventions.
- [ ] No `any`, no legacy APIs listed in §18 in new code.
- [ ] State via signals; async reads via resources; no leaked subscriptions.
- [ ] Accessible markup (labels, focus, keyboard, contrast).
- [ ] SSR-safe (no direct browser globals in shared code).
- [ ] Tests added/updated and passing (`ng test`).
- [ ] `ng build` passes with no new warnings.

---

## Sources (for re-validation)

- Angular LLM prompts & rules files: https://angular.dev/ai/develop-with-ai
- Angular style guide: https://angular.dev/style-guide
- Official Angular agent skills: https://github.com/angular/skills
- Angular v22 release hub: https://angular.dev/events/v22
- What's new in Angular 22.0 (Ninja Squad): https://blog.ninja-squad.com/2026/06/03/what-is-new-angular-22.0
- What's new in Angular 22.1 (Ninja Squad): https://blog.ninja-squad.com/2026/07/29/what-is-new-angular-22.1
- Support schedule: https://endoflife.date/angular
- Full docs for LLMs: https://angular.dev/llms.txt

> Angular ships a minor roughly every two months (v22.2 expected around now). Re-check the sources above when this file is more than a couple of months old.
