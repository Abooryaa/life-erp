# Development

```bash
npm install
npm run dev        # API :4600 (auto-restart) + UI http://localhost:5173 (hot reload)
npm test           # all unit + API tests
npm run typecheck  # TypeScript across all packages
```

Tip: put `LIFE_ERP_DATA_DIR=C:\Users\Admin\LifeERP-Dev` in `.env` while developing so you never touch your real data.

## Adding a module (checklist)
1. **Shared schema**: add Zod input schemas in `packages/shared/src/schemas/` and the entity type in `entities.ts`.
2. **Tables**: add `apps/server/src/db/schema/<module>.ts`, export it from `schema/index.ts`, then run `npm run db:generate`.
3. **Service**: `apps/server/src/modules/<module>/service.ts` holds all business logic (validate with `parse()`, write in `tx()`, call `audit()` and `reindexEntity()`). Call `registerEntity()` so links, tags, search and attachments work.
4. **Routes**: `modules/<module>/routes.ts` stays thin and calls the service. Add it to `moduleRoutes` in `modules/index.ts`.
5. **Jobs** (alerts/automations): `registerJob()` in the module. Jobs must be idempotent; use `notify({ dedupeKey })`.
6. **Tests**: `apps/server/test/<module>.test.ts`, especially for calculations.
7. **UI**: `apps/web/src/features/<module>/`; add a nav entry in `layout/nav.ts` and quick actions in `QuickAddSheet.tsx`.
8. **Strings**: add keys to `i18n/en.ts` **and** `i18n/ar.ts` (the compiler rejects a missing Arabic key).
9. **Demo data**: extend `seed/demo.ts`.
10. **Docs**: update `docs/database.md` and `docs/roadmap.md`.

## UI conventions
- Use the design-system primitives in `components/ui` (Button, Field/TextField, Select, Modal, Panel, Badge…). Don't use raw colours: use the tokens (`bg-surface`, `text-ink-2`, `text-pos`, `text-neg`…).
- Use **logical** spacing (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) so Arabic RTL works automatically. Directional icons get `rtl:rotate-180`.
- Every list has loading, error (with retry) and empty states.
- Forms: `useFormState` + `form.fail(err)` puts server field errors next to fields.
- Money: `fmt.money(minor, currency)`. Dates: `fmt.date()`. Never `toFixed` on stored amounts.
- No button may do nothing. If a feature isn't built yet, it doesn't appear.
