# DEV-UI-01.6-C1 — FormField error announcement

Review finding: the FormField error paragraph carried an id (referenced by the control's
`aria-describedby`) but no announcement semantics, so a newly shown error was not announced.

## Fix
`src/components/ui/form-field.tsx` — only the rendered error changed:

```tsx
<p id={ids.error} className="text-caption text-danger" role="alert" data-field-error="">
  {error}
</p>
```

`role="alert"` only (it implies assertive live-region behaviour; no redundant `aria-live`). The
description stays plain help text (`<p id={ids.description} className="text-caption text-ink-faint">`).
Unchanged: `htmlFor`, `fieldIds()`, both ids, `FieldProps`, the render-function API, `describedBy`,
`invalid`, `required`, ordinary children, and the no-cloning rule (composite controls still place
the metadata on their own focusable element). No consumer passes `error` today, so nothing renders
differently; screenshots were not recaptured.

## Verification
- `verify:document-form`: new check — the error `<p>` has the id derived from `htmlFor`, the caption
  and danger tokens, `role="alert"` and `data-field-error`; the description `<p>` has no `role` /
  `aria-live`. 76/76 (75 at C0; every existing check kept).
- Static mutations: 83/83 caught — the 81 existing (the one that drops the error id now targets the
  new markup) plus "error loses `role=alert`" and "description gains `role=alert`".
- `verify:static`, TypeScript, ESLint, the full browser tier: see the C1 report.
- Guardrails unchanged: G1 36 · G2 280 · G3 8 · G4 0 · G5 28 / 25.
