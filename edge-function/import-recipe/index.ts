// Supabase Edge Function: import-recipe
// Paste this into Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
// It fetches a recipe URL server-side (avoiding browser CORS limits) and extracts
// the schema.org/Recipe structured data that almost all recipe sites embed for
// Google's rich-result snippets — including NYT Cooking, which embeds full
// ingredients/instructions in this markup even on paywalled pages.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (ing && typeof ing === "object") {
    if (ing.name) {
      const val = ing.value ?? "";
      return `${val} ${ing.name}`.trim();
    }
  }
  return String(ing ?? "").trim();
}

function flattenInstructions(instr: any): string[] {
  if (!instr) return [];
  if (typeof instr === "string") {
    // Sometimes a single blob separated by newlines
    return instr.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(instr)) {
    const out: string[] = [];
    for (const step of instr) {
      if (typeof step === "string") out.push(step.trim());
      else if (step?.["@type"] === "HowToSection" && Array.isArray(step.itemListElement)) {
        out.push(...flattenInstructions(step.itemListElement));
      } else if (step?.text) {
        out.push(String(step.text).trim());
      } else if (step?.name) {
        out.push(String(step.name).trim());
      }
    }
    return out.filter(Boolean);
  }
  return [];
}

function findRecipeNode(node: any): any {
  if (!node || typeof node !== "object") return null;
  const type = node["@type"];
  const typeMatches = type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
  if (typeMatches) return node;
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
      const candidates = Array.isArray(json) ? json : [json];
      for (const candidate of candidates) {
        const recipe = findRecipeNode(candidate);
        if (recipe) return recipe;
      }
    } catch (_e) {
      continue;
    }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "Missing url" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pageResp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!pageResp.ok) {
      return new Response(JSON.stringify({ error: `Site returned ${pageResp.status}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const html = await pageResp.text();
    const recipe = extractRecipeFromHtml(html);

    if (!recipe) {
      return new Response(JSON.stringify({ error: "No recipe data found on that page" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ingredients = (recipe.recipeIngredient || recipe.ingredients || []).map(flattenIngredient).filter(Boolean);
    const steps = flattenInstructions(recipe.recipeInstructions);

    let servings: number | null = null;
    const yieldVal = recipe.recipeYield;
    if (yieldVal) {
      const s = Array.isArray(yieldVal) ? yieldVal[0] : yieldVal;
      const m = String(s).match(/\d+/);
      if (m) servings = parseInt(m[0]);
    }

    const result = {
      title: recipe.name || "",
      image_url: firstImage(recipe.image),
      servings,
      prep_time: isoDurationToText(recipe.prepTime),
      cook_time: isoDurationToText(recipe.cookTime || recipe.totalTime),
      ingredients,
      steps,
    };

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
