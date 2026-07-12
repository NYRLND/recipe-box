# House Special

A shared recipe box, grocery list, and 3-day meal plan for Dan & Melissa. No login, installs to the home screen like a native app.

## One-time setup

1. **Supabase** — run the SQL from your setup chat in the SQL Editor if you haven't already.
2. **Edge Function** — in the Supabase Dashboard, go to Edge Functions → Deploy a new function → Via Editor. Name it `import-recipe`, paste in the contents of `edge-function/import-recipe/index.ts`, and click Deploy.
3. **Config** — edit `js/config.js`:
   - `SUPABASE_URL`: Project Settings → API → Project URL
   - `SUPABASE_ANON_KEY`: Project Settings → API Keys → the **Publishable** key (sometimes still labeled "anon public" on older projects — either is safe to use in client-side code)
4. **GitHub Pages** — Settings → Pages → Deploy from branch → `main` / root.
5. Open the Pages URL on both phones → Share → **Add to Home Screen**.

## Notes

- Import works by reading the same structured recipe data (JSON-LD) that sites embed for Google — this covers Damn Delicious, Once Upon a Chef, NYT Cooking, and most food blogs. If a site doesn't have it, use "Or type in a recipe by hand."
- Grocery list merging is simple string-matching, not real unit conversion — if you add "1 cup flour" from one recipe and "200g flour" from another, they'll show as two separate lines rather than being combined.
- The two profiles (Dan/Melissa) are just a lightweight switcher, not real authentication — anyone with the link can use the app as either of you. Fine for a household app; not meant for anything sensitive.
