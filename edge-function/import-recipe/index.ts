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
  { name: "Damn Delicious", host: "damndelicious.net" },
  { name: "Once Upon a Chef", host: "www.onceuponachef.com" },
  { name: "Budget Bytes", host: "www.budgetbytes.com" },
  { name: "Pinch of Yum", host: "pinchofyum.com" },
  { name: "Half Baked Harvest", host: "www.halfbakedharvest.com" },
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

  return {
    title: recipe.name || "",
    image_url: firstImage(recipe.image),
    servings,
    prep_time: isoDurationToText(recipe.prepTime),
    cook_time: isoDurationToText(recipe.cookTime || recipe.totalTime),
    ingredients: (recipe.recipeIngredient || recipe.ingredients || []).map(flattenIngredient).filter(Boolean),
    steps: flattenInstructions(recipe.recipeInstructions),
    tags: extractTags(recipe),
    rating: recipe.aggregateRating?.ratingValue ? Number(recipe.aggregateRating.ratingValue) : null,
  };
}

/* ---------------- search / feed helpers ---------------- */

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–").replace(/<[^>]*>/g, "").trim();
}

async function wpSearch(site: { name: string; host: string }, query: string, perPage: number) {
  const url = `https://${site.host}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=${perPage}&_embed=wp:featuredmedia&orderby=relevance`;
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
  })).filter((r: any) => r.title && r.url);
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
    seen.add(href);
    results.push({ title: text, url: href, image: "", source: site.name });
  }
  return results;
}

async function searchSites(query: string) {
  const perSite = 4;
  const settled = await Promise.allSettled(
    SITES.map(async (site) => {
      try { return await wpSearch(site, query, perSite); }
      catch (_e) { return await htmlSearch(site, query, perSite); }
    })
  );
  const results: any[] = [];
  // interleave so no single site dominates the top
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  for (let i = 0; i < perSite; i++) for (const list of lists) if (list[i]) results.push(list[i]);
  return results;
}

async function latestFeed() {
  const settled = await Promise.allSettled(
    SITES.map(async (site) => {
      const url = `https://${site.host}/wp-json/wp/v2/posts?per_page=2&_embed=wp:featuredmedia`;
      const resp = await fetch(url, { headers: UA });
      if (!resp.ok) throw new Error(`${resp.status}`);
      const posts = await resp.json();
      return posts.map((p: any) => ({
        title: decodeEntities(p.title?.rendered || ""),
        url: p.link,
        image: p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.medium_large?.source_url
            || p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "",
        source: site.name,
      }));
    })
  );
  const results: any[] = [];
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  for (let i = 0; i < 2; i++) for (const list of lists) if (list[i]) results.push(list[i]);
  return results;
}

/* ---------------- handler ---------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();

    if (body.url) return json(await importRecipe(String(body.url)));
    if (body.search) return json({ results: await searchSites(String(body.search).slice(0, 80)) });
    if (body.feed) return json({ results: await latestFeed() });

    return json({ error: "Send { url }, { search }, or { feed: true }" }, 400);
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) });
  }
});
