# Step 2.9b progress: push notifications

Plan: `docs/phase2/plan.md` → 2.9b. Design: `architecture-phase2.md` §4 (and §4.3a, decided in this step),
`api-phase2.md` "Push devices & notification settings", `database-schema-phase2.md`.

Split into three sub-steps. Each ends with a stop: changed files, what to test, a commit message.

## 2.9b.1 API + shared (no phone needed)
- [x] Design gaps decided and written down (architecture §4.3a)
- [ ] `expo-server-sdk` (approved, Q21)
- [ ] Schema + migration: `push_devices`, `user_notification_settings`, `push_messages` (migrate diff, dev + test)
- [ ] Shared: categories, type → category + safe push body, schemas for the new endpoints
- [ ] `PushSender` interface, Expo implementation, fake for tests
- [ ] Outbox fan-out in `createNotification` / `createNotification(s)Once`, same transaction
- [ ] `POST /push-devices`, `POST /push-devices/unregister`, `GET/PATCH /notification-settings/me`
- [ ] Send pass (lease claim, send-time checks, tickets, backoff) + receipts pass
- [ ] Immediate kick after the response (API) + end-of-tick send (worker)
- [ ] Housekeeping: purge `push_messages` > 30 days, disable devices unseen 60 days
- [ ] Cross-tenant tests for every new table/endpoint
- [ ] Register in `jobs.ts` / `app.ts` last (your dev processes reload on save)
- [ ] Typecheck, lint, affected tests

## 2.9b.2 Mobile (ends in a rebuild you run)
- [ ] `expo-notifications` + `expo-device`; block `RECORD_AUDIO`; delete `.npmrc`; gitignore `google-services.json`
- [ ] `app.config` reads `GOOGLE_SERVICES_JSON` for EAS
- [ ] Register on login/start, unregister before logout
- [ ] Tap-to-open (warm + cold), foreground banner + bell refresh
- [ ] Profile → Notifications

## 2.9b.3 Web + close
- [ ] Web notification settings
- [ ] Full workspace check once
- [ ] Report `docs/reports/step-2.9b.md`, device checklist (§4.7 step 9)
