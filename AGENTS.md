<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database — read-only queries are self-service

You have direct read access to the production Supabase database via
`psql "$SUPABASE_DB_URL"` (string lives in `.env.local`). When diagnosing
app behavior, **just run the query**. Do not ask the user to copy/paste
results from the Supabase web console for diagnostic `SELECT`s — that's a
waste of their time when you can do it in one `Bash` call.

If `.env.local` is loaded by your shell, the connection string is already
in scope. If not, `set -a && source .env.local && set +a` exports it for
the current Bash invocation (one-liner before the psql call).

`psql` is installed via Homebrew's `libpq` (keg-only — not on default PATH).
Use the absolute path or export at the top of your Bash call:
```bash
export PATH="/usr/local/opt/libpq/bin:$PATH"
```

## What you may run directly

- `SELECT` (with `LIMIT` when scanning unindexed columns)
- `EXPLAIN` / `EXPLAIN ANALYZE` on read queries
- `SHOW`, `\d`, `\df`, `pg_get_functiondef(...)`, `pg_get_viewdef(...)`
- Anything else strictly read-only that doesn't take locks

## What you may NOT run directly

- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`
- `DROP`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`
- Anything that takes locks (`SELECT ... FOR UPDATE`, `LOCK TABLE`, etc.)
- `pg_dump` against user data

All schema and data changes land as files in `supabase/migrations/` and
apply via the `apply-migrations.yml` workflow (ADR 0006). One-off data
fixes (badge backfills, credit refunds, manual VOIDs) go through that
flow too — never direct psql writes.

## Safety

- **Never echo the connection string, password, or service key.** Use the
  variable directly: `psql "$SUPABASE_DB_URL" -c "..."`. Don't
  `cat .env.local`, don't `echo "$SUPABASE_DB_URL"`, don't pipe creds to
  any log or chat output.
- **Cap unbounded queries.** Add `LIMIT 100` (or smaller) when the
  predicate doesn't hit an index. Production data, production performance
  budget.
- **Quote results carefully.** If a row contains an email, PII, or
  credential-shaped data, redact before quoting it back in chat.

## Patterns

Single-line query:
```bash
psql "$SUPABASE_DB_URL" -c "select badge_type, earned_at from user_badges where user_id = '<uuid>' order by earned_at;"
```

Multi-line query via heredoc (no shell interpolation hazards):
```bash
psql "$SUPABASE_DB_URL" <<'SQL'
select pg_get_functiondef('public.place_bet'::regproc) ilike '%FIRST_BET%' as has_first_bet_logic;
SQL
```

Tabular formatting toggle when you want CSV-style output for parsing:
`psql "$SUPABASE_DB_URL" --csv -c "..."`
