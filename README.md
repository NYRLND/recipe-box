# Recipe Box

A shared recipe box, grocery list, and meal plan for each family household. Installs to the home screen like a native app.

## Accounts and households

- Everyone signs in with their own email and password (Supabase Auth). There's no sign-up screen — accounts are created in the Supabase dashboard and linked to a `household_members` row via `auth_user_id`.
- Each household (Baker-Ryan, Steve & Malinda's, Kelsey & Chase's) only sees its own recipes, plan, grocery list and favorites. That's enforced by row-level security in the database (`my_household_id()`), not by the app.
- Recipes can be shared across households. A share sends a copy, not a live link.
- Baker-Ryan's grocery list is also shown in Hearth, which uses the same Supabase project.

## Speed and offline

- The service worker (`sw.js`) opens the app from the phone's cache and checks for updates in the background, so a new deploy shows up on the second launch. **Bump `CACHE` in `sw.js` on every deploy.**
- Each screen draws first from a copy saved on the phone (`rb_snap_*` in localStorage), then refreshes from Supabase. If a fetch fails, the saved copy stays on screen. Signing out clears it.
- Launch uses the saved session and member, so a weak signal never shows the login screen. Only a definite "this account isn't linked" answer from the server signs someone out.

## One-time setup

1. **Supabase**: `schema.sql` documents the schema and policies. It's safe to re-run.
2. **Edge Function**: deploy `edge-function/import-recipe/index.ts` as `import-recipe`.
3. **Config**: `js/config.js` holds the project URL and publishable key. Both are safe in client code.
4. **GitHub Pages**: deploy from `main` / root.

## Notes

- Import reads the structured recipe data (JSON-LD) that sites embed for Google. If a site doesn't have it, use "Or type in a recipe by hand."
- Grocery merging is string matching, not unit conversion. "1 cup flour" and "200g flour" stay as two lines.
