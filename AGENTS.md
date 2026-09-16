# NoriVideo repository operating rules

## Production target

- The only active production server is `45.76.215.9` (`lanmiao-test.xyz`).
- Do not access or deploy to the retired `118.196.6.130` server.

## Fixed TOS storage policy

- Development and production must use Volcengine TOS in `cn-beijing` with bucket `nori-test`.
- The approved AK/SK live only in ignored secret files (`.env`, `config/services.json`, and `config/services.prod.json`) and in the server's protected equivalents. Never commit or print them.
- `scripts/guards/fixed-tos-config-guard.mjs` stores only credential fingerprints and must pass before development or production startup. Do not bypass it or replace the credentials/bucket with example or legacy values.
- Future deployments must preserve `/opt/norivideo/.env` and `/opt/norivideo/data/services.prod.json`, validate the fixed-TOS guard, and run a TOS upload/read/delete probe before handoff.
