import { Component } from '@angular/core';

/** The Stabilitea teacup mark. Decorative; the wordmark carries the name. */
@Component({
  selector: 'app-teacup-logo',
  host: { 'aria-hidden': 'true' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="34" height="34" focusable="false">
      <path d="M6 13h16v4a8 8 0 0 1-8 8h0a8 8 0 0 1-8-8z" fill="var(--st-green-soft)" stroke="var(--st-green)" stroke-width="2" stroke-linejoin="round" />
      <path d="M22 15h1.5a3 3 0 0 1 0 6H21" fill="none" stroke="var(--st-green)" stroke-width="2" stroke-linecap="round" />
      <path d="M11 5c1 1.5-1 2.5 0 4M16 5c1 1.5-1 2.5 0 4" fill="none" stroke="var(--st-orange-soft)" stroke-width="2" stroke-linecap="round" />
      <path d="M5 27h18" stroke="var(--st-green)" stroke-width="2" stroke-linecap="round" />
    </svg>
  `,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class TeacupLogo {}
