# TinyBit Server — Agent Rules

Read `CLAUDE.md` for full project context. The rules below are non-negotiable for any agent session.

## No code patches

A **code patch** is a temporary workaround in application/server code instead of fixing the real
problem — fabricating metrics, inventing dummy responses, estimating values the DB doesn’t store,
or hardcoding fake data to make a UI look complete.

**Do not ship code patches.** Prefer real persistence + APIs, or honest empties (`null` / omit).

## MySQL patches are required (not “code patches”)

| Artifact | Purpose |
|----------|---------|
| `mysql/schema.sql` | Full `CREATE` script for **new** databases |
| `mysql/patches/*.sql` | `ALTER` (etc.) for **existing** databases |

When schema changes: update **both** — add/adjust the CREATE in `schema.sql`, and add a dated file
under `mysql/patches/` so live DBs can be upgraded. Never delete the patches workflow.

## Related

See Architecture / Database sections in `CLAUDE.md`.
