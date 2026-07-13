// Supabase Edge Function: import-recipe  (v2)
// Handles three actions in one function:
//   { url }              -> import a single recipe from any page with schema.org Recipe data
//   { search: "query" }  -> search recipes across the curated sites below
//   { feed: true }       -> latest recipes from the curated sites
//
// To update: Supabase Dashboard -> Edge Functions -> import-recipe -> replace code -> Deploy updates

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Curated sources. All are WordPress sites, searched via their public
// wp-json REST API with an HTML-search fallback. Edit freely.
const SITES = [
  { name: "Damn Delicious", host: "damndelicious.net", focus: "dinner" },
  { name: "Once Upon a Chef", host: "www.onceuponachef.com", focus: "dinner" },
  { name: "RecipeTin Eats", host: "www.recipetineats.com", focus: "dinner" },
  { name: "Gimme Some Oven", host: "www.gimmesomeoven.com", focus: "dinner" },
  { name: "Cafe Delites", host: "cafedelites.com", focus: "dinner" },
  { name: "The Recipe Critic", host: "therecipecritic.com", focus: "dinner" },
  { name: "Natasha's Kitchen", host: "natashaskitchen.com", focus: "dinner" },
  { name: "Dinner at the Zoo", host: "www.dinneratthezoo.com", focus: "dinner" },
  { name: "Budget Bytes", host: "www.budgetbytes.com", focus: "dinner" },
  { name: "Pinch of Yum", host: "pinchofyum.com", focus: "dinner" },
  { name: "Half Baked Harvest", host: "www.halfbakedharvest.com", focus: "dinner" },
  { name: "Cookie and Kate", host: "cookieandkate.com", focus: "dinner" },
  { name: "Sally's Baking Addiction", host: "sallysbakingaddiction.com", focus: "baking" },
];

const UA = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Accept": "text/html,application/json" };

/* ---------------- import helpers ---------------- */

function isoDurationToText(iso?: string): string {
  if (!iso) return "";
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return "";
  const [, d, h, mnt] = m;
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === "1" ? "" : "s"}`);
  if (h) parts.push(`${h} hr`);
  if (mnt) parts.push(`${mnt} min`);
  return parts.join(" ");
}

function flattenIngredient(ing: any): string {
  if (typeof ing === "string") return ing.trim();
  if (ing && typeof ing === "object" && ing.name) return `${ing.value ?? ""} ${ing.name}`.trim();
  return String(ing ?? "").trim();
}

function flattenInstructions(instr: any): string[] {
  if (!instr) return [];
  if (typeof instr === "string") return instr.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(instr)) {
    const out: string[] = [];
    for (const step of instr) {
      if (typeof step === "string") out.push(step.trim());
      else if (step?.["@type"] === "HowToSection" && Array.isArray(step.itemListElement)) out.push(...flattenInstructions(step.itemListElement));
      else if (step?.text) out.push(String(step.text).trim());
      else if (step?.name) out.push(String(step.name).trim());
    }
    return out.filter(Boolean);
  }
  return [];
}

function findRecipeNode(node: any): any {
  if (!node || typeof node !== "object") return null;
  const type = node["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return node;
  if (Array.isArray(node["@graph"])) {
    for (const item of node["@graph"]) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
  }
  return null;
}

function extractRecipeFromHtml(html: string): any {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      for (const candidate of Array.isArray(json) ? json : [json]) {
        const recipe = findRecipeNode(candidate);
        if (recipe) return recipe;
      }
    } catch (_e) { continue; }
  }
  return null;
}

function firstImage(image: any): string {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (image.url) return image.url;
  return "";
}

function extractTags(recipe: any): string[] {
  const tags = new Set<string>();
  const add = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(add);
    String(v).split(",").map((s) => s.trim()).filter((s) => s && s.length < 24).slice(0, 4).forEach((t) => tags.add(t));
  };
  add(recipe.recipeCategory);
  add(recipe.recipeCuisine);
  return Array.from(tags).slice(0, 5);
}

async function importRecipe(url: string) {
  const pageResp = await fetch(url, { headers: UA });
  if (!pageResp.ok) return { error: `Site returned ${pageResp.status}` };
  const html = await pageResp.text();
  const recipe = extractRecipeFromHtml(html);
  if (!recipe) return { error: "No recipe data found on that page" };

  let servings: number | null = null;
  const yieldVal = recipe.recipeYield;
  if (yieldVal) {
    const m = String(Array.isArray(yieldVal) ? yieldVal[0] : yieldVal).match(/\d+/);
    if (m) servings = parseInt(m[0]);
  }

  const result = {
    title: recipe.name || "",
    image_url: firstImage(recipe.image),
    servings,
    prep_time: isoDurationToText(recipe.prepTime),
    cook_time: isoDurationToText(recipe.cookTime || recipe.totalTime),
    ingredients: (recipe.recipeIngredient || recipe.ingredients || []).map(flattenIngredient).filter(Boolean),
    steps: flattenInstructions(recipe.recipeInstructions),
    tags: extractTags(recipe),
    rating: recipe.aggregateRating?.ratingValue ? Number(recipe.aggregateRating.ratingValue) : null,
    rating_count: Number(recipe.aggregateRating?.ratingCount || recipe.aggregateRating?.reviewCount) || null,
  };

  return result;
}

/* ---------------- rating enrichment for discover cards ---------------- */

// warm-instance cache: url -> {rating, rating_count}
const ratingCache = new Map<string, { rating: number | null; rating_count: number | null }>();

async function fetchRating(url: string) {
  if (ratingCache.has(url)) return ratingCache.get(url)!;
  const out = { rating: null as number | null, rating_count: null as number | null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const resp = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(t);
    if (resp.ok) {
      const html = await resp.text();
      const recipe = extractRecipeFromHtml(html);
      if (recipe?.aggregateRating) {
        out.rating = Number(recipe.aggregateRating.ratingValue) || null;
        out.rating_count = Number(recipe.aggregateRating.ratingCount || recipe.aggregateRating.reviewCount) || null;
      }
    }
  } catch (_e) { /* fail soft */ }
  ratingCache.set(url, out);
  if (ratingCache.size > 800) ratingCache.delete(ratingCache.keys().next().value!);
  return out;
}

async function enrichRatings(results: any[], limit = 14) {
  await Promise.allSettled(results.slice(0, limit).map(async (r) => {
    const { rating, rating_count } = await fetchRating(r.url);
    r.rating = rating;
    r.rating_count = rating_count;
  }));
  return results;
}

/* ---------------- search / feed helpers ---------------- */

// Articles like "35 Best Chicken Recipes" or meal-prep roundups contain many
// recipes and can't be imported as one — filter them out of Discover.
function looksLikeRoundup(title: string, url: string): boolean {
  const t = title.toLowerCase();
  const u = url.toLowerCase();
  if (/\b\d{1,3}\s+(?:\w+\s+){0,3}recipes\b/.test(t)) return true;      // "35 best chicken recipes"
  if (/\brecipes\s+(?:for|to)\b/.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/round-?up|meal\s*plan|menu\s*plan|meal\s*prep\s*(?:menu|plan|ideas)|gift guide|what to cook|weekly menu|dinner ideas|shopping list/i.test(t)) return true;
  // non-recipe posts: announcements, community/life updates, promos
  if (/giveaway|announcement|cookbook|behind the scenes|the things we do|life lately|q\s*&\s*a|reader survey|we'?re hiring|year in review|my favorite (products|things)|gift ideas/i.test(t)) return true;
  if (/round-?up|meal-?plan|menu-?plan|weekly-menu|gift-guide|giveaway|announcement/.test(u)) return true;
  return false;
}

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–").replace(/<[^>]*>/g, "").trim();
}

async function wpSearch(site: { name: string; host: string }, query: string, perPage: number, page: number) {
  const url = `https://${site.host}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&_embed=wp:featuredmedia&orderby=relevance`;
  const resp = await fetch(url, { headers: UA });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const posts = await resp.json();
  if (!Array.isArray(posts)) throw new Error("bad response");
  return posts.map((p: any) => ({
    title: decodeEntities(p.title?.rendered || ""),
    url: p.link,
    image: p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.medium_large?.source_url
        || p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "",
    source: site.name,
  })).filter((r: any) => r.title && r.url && !looksLikeRoundup(r.title, r.url));
}

// Fallback for sites that disable the REST API: parse their HTML search page.
async function htmlSearch(site: { name: string; host: string }, query: string, limit: number) {
  const resp = await fetch(`https://${site.host}/?s=${encodeURIComponent(query)}`, { headers: UA });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const html = await resp.text();
  const results: any[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{4,90})<\/a>/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null && results.length < limit) {
    const href = m[1];
    const text = decodeEntities(m[2]);
    if (!href.includes(site.host.replace("www.", ""))) continue;
    if (/\/(category|tag|about|contact|page|author|shop|privacy)\//i.test(href)) continue;
    if (seen.has(href) || !text || /^(read more|continue|home|recipes?)$/i.test(text)) continue;
    if (looksLikeRoundup(text, href)) continue;
    seen.add(href);
    results.push({ title: text, url: href, image: "", source: site.name });
  }
  return results;
}

// NYT Cooking: no public API, but its search page server-renders recipe links
// (/recipes/{id}-{slug}). Best effort — titles derived from the slug.
async function nytSearch(query: string, limit: number) {
  const resp = await fetch(`https://cooking.nytimes.com/search?q=${encodeURIComponent(query)}`, { headers: UA });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const html = await resp.text();
  const results: any[] = [];
  const seen = new Set<string>();
  const re = /href="(\/recipes\/(\d+)-([a-z0-9-]+))"/gi;
  let m;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const title = m[3].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    results.push({ title, url: `https://cooking.nytimes.com${path}`, image: "", source: "NYT Cooking" });
  }
  return results;
}

function activeSites(sources?: string[]) {
  if (!Array.isArray(sources) || !sources.length) return SITES;
  const set = new Set(sources);
  const filtered = SITES.filter((s) => set.has(s.host));
  return filtered.length ? filtered : SITES;
}

async function searchSites(query: string, page: number, sources?: string[]) {
  const sites = activeSites(sources);
  const perSite = sites.length <= 3 ? 8 : 4;
  const tasks: Promise<any[]>[] = sites.map(async (site) => {
    try { return await wpSearch(site, query, perSite, page); }
    catch (_e) { return page === 1 ? await htmlSearch(site, query, perSite) : []; }
  });
  // NYT only on the first page, and only when not filtering to specific sources
  if (page === 1 && (!sources || !sources.length)) tasks.push(nytSearch(query, 4).catch(() => []));
  const settled = await Promise.allSettled(tasks);
  const results: any[] = [];
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  for (let i = 0; i < 8; i++) for (const list of lists) if (list[i]) results.push(list[i]);
  return results;
}

async function wpLatest(site: { name: string; host: string }, perPage: number, offset: number) {
  const url = `https://${site.host}/wp-json/wp/v2/posts?per_page=${perPage}&offset=${offset}&_embed=wp:featuredmedia`;
  const resp = await fetch(url, { headers: UA });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const posts = await resp.json();
  if (!Array.isArray(posts)) throw new Error("bad response");
  return posts.map((p: any) => ({
    title: decodeEntities(p.title?.rendered || ""),
    url: p.link,
    image: p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.medium_large?.source_url
        || p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "",
    source: site.name,
  })).filter((r: any) => r.title && r.url && !looksLikeRoundup(r.title, r.url));
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Discovery feed: pulls DEEP into each site's archive using a per-session
// random seed offset (so the same recipes don't surface every time), and
// mixes in searches for the family's learned interests from their recipe box.
async function latestFeed(page: number, seed: number, sources?: string[], interests?: string[]) {
  // Default feed is dinner ideas — baking-focused sites join in only when explicitly selected
  const sites = (Array.isArray(sources) && sources.length)
    ? activeSites(sources)
    : SITES.filter((s) => s.focus !== "baking");
  const per = 3;
  const tasks: Promise<any[]>[] = sites.map(async (site) => {
    const offset = seed + (page - 1) * per;
    try { return await wpLatest(site, per, offset); }
    catch (_e) {
      try { return await wpLatest(site, per, (page - 1) * per); } // site archive shallower than the seed — fall back
      catch (_e2) { return []; }
    }
  });
  // interest mixing: a couple of taste-based searches woven into the feed
  const terms = (interests || []).filter((t) => typeof t === "string" && t.length > 2).slice(0, 3);
  for (const term of terms) {
    const site = sites[Math.floor(Math.random() * sites.length)];
    tasks.push(wpSearch(site, term, 3, 1 + (page - 1) % 3).catch(() => []));
  }
  const settled = await Promise.allSettled(tasks);
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const results: any[] = [];
  for (let i = 0; i < per; i++) for (const list of lists) if (list[i]) results.push(list[i]);
  // de-dup by url, then shuffle so ordering varies
  const seen = new Set<string>();
  return shuffle(results.filter((r) => !seen.has(r.url) && seen.add(r.url)));
}

/* ---------------- handler ---------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const page = Math.max(1, Math.min(20, parseInt(body.page) || 1));
    const seed = Math.max(0, Math.min(300, parseInt(body.seed) || 0));

    if (body.url) return json(await importRecipe(String(body.url)));
    if (body.sites) return json({ sites: SITES });
    if (Array.isArray(body.ratings)) {
      const urls: string[] = body.ratings.slice(0, 12).map(String);
      const out: Record<string, { rating: number | null; rating_count: number | null }> = {};
      await Promise.allSettled(urls.map(async (u) => { out[u] = await fetchRating(u); }));
      return json({ ratings: out });
    }
    if (body.search) return json({ results: await enrichRatings(await searchSites(String(body.search).slice(0, 80), page, body.sources)) });
    if (body.feed) return json({ results: await enrichRatings(await latestFeed(page, seed, body.sources, body.interests)) });

    return json({ error: "Send { url }, { search }, or { feed: true }" }, 400);
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) });
  }
});
