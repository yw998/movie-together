# Supabase Auth email templates

These files are the reviewed source for the production Supabase Auth templates.
They contain no remote images or tracking resources. `{{ .ConfirmationURL }}` is
the Supabase-generated, single-use action URL and must remain unchanged.

Upload the matching subject and HTML in **Supabase Dashboard → Authentication →
Email Templates**. Preview and send one confirmation and one recovery message
before enabling public registration. Never paste a real action URL into Git.
