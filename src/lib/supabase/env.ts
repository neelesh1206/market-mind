/**
 * Supabase env vars, validated at module load.
 *
 * IMPORTANT: Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed
 * via *literal property syntax* (`process.env.NEXT_PUBLIC_SUPABASE_URL`).
 * Dynamic access (`process.env[name]`) is NOT inlined and will be `undefined`
 * in the browser bundle.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/file-conventions/env
 */

// Static access — gets inlined into the client bundle at build time.
const SUPABASE_URL_RAW = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY_RAW = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL_RAW) {
  throw new Error(
    "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL. " +
      "Add it to .env.local and restart `npm run dev`.",
  );
}
if (!SUPABASE_ANON_KEY_RAW) {
  throw new Error(
    "Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Add it to .env.local and restart `npm run dev`.",
  );
}

export const SUPABASE_URL: string = SUPABASE_URL_RAW;
export const SUPABASE_ANON_KEY: string = SUPABASE_ANON_KEY_RAW;
