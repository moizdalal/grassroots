// Browser entry for supabase-js, bundled to public/vendor/supabase-js.js
// by `npm run build:supabase`. Self-hosting one file replaces ~10
// chained esm.sh module requests on every page load. The version is
// pinned via the `supabase-js-browser` alias in package.json so the
// browser client doesn't drift with the server's @supabase/supabase-js.
export { createClient } from "supabase-js-browser";
