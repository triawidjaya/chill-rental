-- =============================================================
-- Chill Rental — switch RLS from anon (open) to authenticated (business login)
-- Run this in Supabase SQL Editor AFTER you create the business Auth account.
--
-- Effect: only requests carrying a valid Supabase Auth session (i.e. someone who
-- signed in with the business email/password) may read/write. The anon key alone
-- can no longer touch the data, so it is safe to ship in the static deployment.
--
-- Re-runnable.
-- =============================================================

do $$
declare
  t text;
  tables text[] := array['motors','rentals','owners','damages','staff','audit_log'];
begin
  foreach t in array tables
  loop
    -- Remove the old permissive anon policy
    execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
    -- (Re)create the authenticated-only policy
    execute format('drop policy if exists %I on public.%I;', t || '_auth_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_auth_all', t
    );
  end loop;
end $$;

-- IMPORTANT (do these in the Dashboard, not SQL):
--   1. Authentication → Users → "Add user" → create ONE business account
--      (email + password). This is what the app's email login uses.
--   2. Authentication → Providers → Email → turn OFF "Enable sign-ups"
--      so the public cannot self-register. You create accounts manually.
