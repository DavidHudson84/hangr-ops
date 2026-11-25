# Hangr Ops

Store-by-store sales and customer platform for Master Dry Cleaners, built to take other businesses later.

- Live: https://davidhudson84.github.io/hangr-ops/
- Backend: Supabase project `hangr-ops` (`pswvmkrtnantiwjoexyq`, Sydney).
- A push to `main` is a live deploy (GitHub Pages).

Every table has row-level security. The publishable key in `app.js` grants nothing on its own:
a store manager reads only their store's rows, and anonymous requests read nothing. Uploads go
through `upload_begin` / `ingest_*` / `upload_finish`, which check the caller's role (or a loader
key whose sha256 alone is stored in the database).
