# NoriVideo repository operating rules

## Production target

- The only active production server is the 备案机 `14.103.65.61`, serving `lanmiaoai.com`: workbench at `https://lanmiaoai.com/zh/auth/signin`, admin at `https://lanmiaoai.com:8080/zh/admin/signin`.
- Retired servers, never access, deploy to, probe, or restore them: `45.76.215.9` (`lanmiao-test.xyz`) and `118.196.6.130`.
- `.deploy.env` pins the release targets through `PUBLIC_APP_URL` and `PUBLIC_ADMIN_URL`; keep both pointed at the 备案机 and never repoint them at a retired host.
- Everything under `deploy/` documents the retired `lanmiao-test.xyz` / `118.196.6.130` setup. Do not apply those configs to the 备案机; see `deploy/README.md`.

## Fixed TOS storage policy

- Development and production must use Volcengine TOS in `cn-beijing` with bucket `nori-test`.
- The approved AK/SK live only in ignored secret files (`.env`, `config/services.json`, and `config/services.prod.json`) and in the server's protected equivalents. Never commit or print them.
- `scripts/guards/fixed-tos-config-guard.mjs` stores only credential fingerprints and must pass before development or production startup. Do not bypass it or replace the credentials/bucket with example or legacy values.
- Future deployments must preserve `/opt/norivideo/.env` and `/opt/norivideo/data/services.prod.json`, validate the fixed-TOS guard, and run a TOS upload/read/delete probe before handoff.
