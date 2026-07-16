import { supabase } from './supabase-client.js';
import { IMPORT_RECIPE_FN, SUPABASE_ANON_KEY } from './config.js';

/* ================= Utilities ================= */

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function toast(msg) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatDayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  const diff = Math.round((new Date(iso) - new Date(todayISO())) / 86400000);
  if (iso === todayISO()) return 'Today';
  if (iso === todayISO(1)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

function formatDateSub(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Parse "1 1/2 cups flour" -> {amount: 1.5, unit: 'cup', item: 'flour', raw}
const UNIT_WORDS = ['cup','cups','tbsp','tablespoon','tablespoons','tsp','teaspoon','teaspoons','oz','ounce','ounces','lb','lbs','pound','pounds','g','gram','grams','kg','kilogram','ml','milliliter','l','liter','liters','clove','cloves','can','cans','pinch','pinches','slice','slices','stick','sticks','bunch','bunches','head','heads','sprig','sprigs','package','packages','pkg'];
const UNICODE_FRAC = { '½':0.5,'⅓':1/3,'⅔':2/3,'¼':0.25,'¾':0.75,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875 };

function parseIngredientLine(raw) {
  const line = (raw || '').trim();
  let amount = null, unit = '', rest = line;
  const m = line.match(/^([\d.\/½⅓⅔¼¾⅛⅜⅝⅞\s]+)\s+(.*)$/);
  if (m) {
    const numPart = m[1].trim();
    rest = m[2];
    let total = 0, matched = false;
    numPart.split(/\s+/).forEach(tok => {
      if (UNICODE_FRAC[tok] !== undefined) { total += UNICODE_FRAC[tok]; matched = true; }
      else if (/^\d+\/\d+$/.test(tok)) { const [a,b] = tok.split('/'); total += parseInt(a)/parseInt(b); matched = true; }
      else if (/^\d*\.?\d+$/.test(tok)) { total += parseFloat(tok); matched = true; }
    });
    if (matched) amount = total;
  }
  const restWords = rest.split(/\s+/);
  if (restWords.length && UNIT_WORDS.includes(restWords[0].toLowerCase().replace(/[.,]/g,''))) {
    unit = restWords[0].toLowerCase().replace(/[.,]/g,'');
    rest = restWords.slice(1).join(' ');
  }
  return { amount, unit, item: rest || line, raw: line };
}

function formatAmount(n) {
  if (n === null || n === undefined) return '';
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracMap = [[0.125,'⅛'],[0.25,'¼'],[0.333,'⅓'],[0.375,'⅜'],[0.5,'½'],[0.625,'⅝'],[0.667,'⅔'],[0.75,'¾'],[0.875,'⅞']];
  let closest = null, dist = 0.06;
  for (const [v,s] of fracMap) if (Math.abs(frac - v) < dist) { closest = s; dist = Math.abs(frac-v); }
  if (frac < 0.04) return String(whole || 0);
  if (closest) return (whole ? whole + ' ' : '') + closest;
  return (Math.round(n * 100) / 100).toString();
}

function ingredientDisplay(ing, scale) {
  if (ing.amount === null || ing.amount === undefined) return { amt: '', text: ing.item };
  const scaled = ing.amount * scale;
  const amtStr = formatAmount(scaled) + (ing.unit ? ' ' + ing.unit : '');
  return { amt: amtStr, text: ing.item };
}

const GROCERY_CATEGORIES = [
  { name: 'Produce', words: ['lettuce','onion','garlic','tomato','pepper','carrot','potato','herb','basil','cilantro','parsley','lemon','lime','apple','avocado','spinach','kale','mushroom','celery','cucumber','broccoli','ginger','scallion','shallot','zucchini','squash','fruit','vegetable'] },
  { name: 'Meat & Seafood', words: ['chicken','beef','pork','turkey','bacon','sausage','shrimp','salmon','fish','steak','lamb','ground meat'] },
  { name: 'Dairy & Eggs', words: ['milk','cheese','butter','cream','yogurt','egg','parmesan','mozzarella','sour cream'] },
  { name: 'Bakery', words: ['bread','bun','roll','tortilla','baguette','pita'] },
  { name: 'Pantry', words: ['flour','sugar','oil','vinegar','rice','pasta','beans','can ','stock','broth','sauce','spice','salt','pepper ','baking','cereal','nut','honey','syrup'] },
  { name: 'Frozen', words: ['frozen','ice cream'] },
];

function categorize(itemName) {
  const s = itemName.toLowerCase();
  for (const cat of GROCERY_CATEGORIES) if (cat.words.some(w => s.includes(w))) return cat.name;
  return 'Other';
}

// Two distinct, stable colors for member badges — shared visual language with Hearth.
// Falls back to ink-faint for any member beyond the first two (or unknown/legacy rows).
const BADGE_PALETTE = ['#4A7C8C', '#C1666B']; // teal (1st member), muted rose (2nd member)

function memberColorFor(id) {
  if (!id) return '#9A9384';
  const idx = state.members.findIndex(m => m.id === id);
  return idx === -1 ? '#9A9384' : BADGE_PALETTE[idx % BADGE_PALETTE.length];
}

function memberBadge(id) {
  const m = state.members.find(x => x.id === id);
  if (!m || !m.name) return null;
  const badge = el('div', 'member-badge');
  badge.textContent = m.name.trim().charAt(0).toUpperCase();
  badge.style.background = memberColorFor(id);
  badge.title = m.name;
  return badge;
}

// Decode HTML entities (&amp;, &#39;, etc.) that sometimes ride along in scraped ingredient text.
function decodeHtmlEntities(str) {
  const ta = document.createElement('textarea');
  ta.innerHTML = str;
  return ta.value;
}

// Turn a raw ingredient line into a short, shoppable item name shared with Hearth's UI.
// Strips parenthetical asides ("(or thyme, sage)") out of the name; if the aside looks like
// a genuine substitution/brand note rather than filler, it's kept and returned separately
// so the caller can fold it into `amount` instead of leaving it jammed into `item`.
function cleanGroceryItemText(raw) {
  let text = decodeHtmlEntities(String(raw || '')).trim();
  let note = null;
  const m = text.match(/\s*\(([^)]+)\)/);
  if (m) {
    const inner = m[1].trim();
    text = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
    if (inner && /\b(or|optional|preferably|sub|substitute|not |brand)\b/i.test(inner)) {
      note = inner;
    }
  }
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,;.])/g, '$1').replace(/[,;]\s*$/, '').trim();
  return { item: text, note };
}

function timerSecondsFromStep(text) {
  const m = text.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*(minute|min|hour|hr)s?/i);
  if (!m) return null;
  const n = m[2] ? (parseInt(m[1]) + parseInt(m[2])) / 2 : parseInt(m[1]);
  const isHour = /hour|hr/i.test(m[3]);
  return Math.round(n * (isHour ? 3600 : 60));
}

/* ================= State ================= */

const state = {
  member: JSON.parse(localStorage.getItem('t42_member') || 'null'),
  members: [],
  recipes: [],
  favorites: new Set(),
  tags: [],
  activeTag: null,
  searchTerm: '',
  currentRecipe: null,
  currentServings: null,
  draft: null,          // recipe being edited/imported/remixed
  draftMode: 'manual',  // 'manual' | 'import' | 'remix'
  parentForRemix: null,
  groceryItems: [],
  
  planEntries: {},      // date -> recipe row
  cookRecipe: null,
  cookIndex: 0,
  timerInterval: null,
  shareTargetRecipe: null,
};

/* ================= View routing (history-aware: phone back button navigates, doesn't exit) ================= */

let navSuppress = false;

function pushNav(stateObj) {
  if (!navSuppress) history.pushState(stateObj, '');
}

window.addEventListener('popstate', (e) => {
  navSuppress = true;
  const s = e.state;
  if (!s || s.v === 'tab') {
    setTab(s?.tab || 'box');
  } else if (s.v === 'detail' && state.currentRecipe) {
    renderRecipeDetail(state.currentRecipe, { preview: !!state.previewMode });
  } else {
    setTab('box');
  }
  navSuppress = false;
});

const scrollMem = {};

function showView(id) {
  const current = qsa('.view').find(v => !v.hidden);
  if (current) scrollMem[current.id] = window.scrollY;
  qsa('.view').forEach(v => v.hidden = true);
  qs('#' + id).hidden = false;
  requestAnimationFrame(() => window.scrollTo(0, scrollMem[id] || 0));
}

function setTab(tab) {
  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'box') { showView('view-box'); renderBox(); }
  if (tab === 'discover') { showView('view-discover'); initDiscover(); }
  if (tab === 'plan') { showView('view-plan'); loadPlan(); }
  if (tab === 'grocery') { showView('view-grocery'); loadGrocery(); }
  qs('#fab-add').hidden = tab !== 'box';
  const names = { box: 'Recipe Box', discover: 'Discover', plan: 'Meal Plan', grocery: 'Grocery List' };
  qs('#topbar-eyebrow').textContent = names[tab] || '';
  if (tab !== 'box') pushNav({ v: 'tab', tab });
}

/* ================= Boot ================= */

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const { data: members } = await supabase.from('household_members').select('*');
  state.members = members || [];

  if (!state.member) {
    showView('view-onboard');
    const picker = qs('#who-picker');
    picker.innerHTML = '';
    const names = state.members.length ? state.members : [{ id: null, name: 'Dan' }, { id: null, name: 'Melissa' }];
    names.forEach(m => {
      const b = el('button', null, m.name);
      b.addEventListener('click', () => {
        state.member = m;
        localStorage.setItem('t42_member', JSON.stringify(m));
        startApp();
      });
      picker.appendChild(b);
    });
    return;
  }
  startApp();
}

function startApp() {
  history.replaceState({ v: 'tab', tab: 'box' }, '');
  qs('#topbar').hidden = false;
  qs('#tabbar').hidden = false;
  qs('#who-badge').textContent = state.member.name[0];
  qs('#topbar-title').textContent = greeting();
  setTab('box');
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 11 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, ${state.member.name}`;
}

qs('#who-badge').addEventListener('click', () => {
  if (!state.members.length) return;
  const idx = state.members.findIndex(m => m.name === state.member.name);
  const other = state.members[(idx + 1) % state.members.length];
  state.member = other;
  localStorage.setItem('t42_member', JSON.stringify(other));
  qs('#who-badge').textContent = other.name[0];
  qs('#topbar-title').textContent = greeting();
  toast(`Switched to ${other.name}`);
  loadFavorites().then(renderBox);
});

qsa('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

/* ================= Recipe Box ================= */

async function loadFavorites() {
  if (!state.member?.id) return;
  const { data } = await supabase.from('favorites').select('recipe_id').eq('member_id', state.member.id);
  state.favorites = new Set((data || []).map(r => r.recipe_id));
}

async function loadRecipes() {
  const { data } = await supabase.from('recipes').select('*').order('created_at', { ascending: false });
  state.recipes = data || [];
  const tagCounts = {};
  state.recipes.filter(r => r.in_box !== false).forEach(r => (r.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  state.tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

async function renderBox() {
  await Promise.all([loadRecipes(), loadFavorites()]);
  renderTagChips();
  drawGrid();
}

let tagsExpanded = false;
const TAG_CAP = 6;

function renderTagChips() {
  const row = qs('#tag-chips');
  row.innerHTML = '';
  const favChip = el('button', 'chip' + (state.activeTag === '__fav' ? ' active' : ''), '♥ Favorites');
  favChip.addEventListener('click', () => { state.activeTag = state.activeTag === '__fav' ? null : '__fav'; renderTagChips(); drawGrid(); });
  row.appendChild(favChip);

  // active tag always visible, even if it lives past the cap
  let tags = state.tags;
  if (!tagsExpanded && tags.length > TAG_CAP) {
    tags = tags.slice(0, TAG_CAP);
    if (state.activeTag && state.activeTag !== '__fav' && !tags.includes(state.activeTag)) tags = [...tags.slice(0, TAG_CAP - 1), state.activeTag];
  }

  tags.forEach(tag => {
    const c = el('button', 'chip' + (state.activeTag === tag ? ' active' : ''), tag);
    c.addEventListener('click', () => { state.activeTag = state.activeTag === tag ? null : tag; renderTagChips(); drawGrid(); });
    row.appendChild(c);
  });

  if (state.tags.length > TAG_CAP) {
    const more = el('button', 'chip chip-more', tagsExpanded ? 'less ▴' : `more ▾`);
    more.addEventListener('click', () => { tagsExpanded = !tagsExpanded; renderTagChips(); });
    row.appendChild(more);
  }
}

function drawGrid() {
  const grid = qs('#recipe-grid');
  grid.innerHTML = '';
  let list = state.recipes.filter(r => r.in_box !== false);
  if (state.activeTag === '__fav') list = list.filter(r => state.favorites.has(r.id));
  else if (state.activeTag) list = list.filter(r => (r.tags || []).includes(state.activeTag));
  if (state.searchTerm) {
    const s = state.searchTerm.toLowerCase();
    list = list.filter(r => r.title.toLowerCase().includes(s) || (r.source || '').toLowerCase().includes(s));
  }
  qs('#box-empty').hidden = state.recipes.length > 0;
  list.forEach(r => grid.appendChild(recipeCard(r)));
}

function recipeCard(r) {
  const card = el('div', 'recipe-card');
  const thumb = el('div', 'thumb');
  if (r.image_url) thumb.style.backgroundImage = `url('${r.image_url}')`;
  else thumb.textContent = r.title[0];
  card.appendChild(thumb);

  const fav = el('button', 'fav-btn' + (state.favorites.has(r.id) ? ' active' : ''),
    `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.5 8 2.3 4.5 6 4.2c2-.2 3.7 1 6 3.5 2.3-2.5 4-3.7 6-3.5 3.7.3 5.5 3.8 4 7.5-2.5 4.7-10 9.3-10 9.3z"/></svg>`);
  fav.addEventListener('click', async (e) => { e.stopPropagation(); await toggleFavorite(r.id, fav); });
  card.appendChild(fav);

  const body = el('div', 'body');
  body.appendChild(el('h3', null, r.title));
  body.appendChild(el('div', 'source', r.source || 'Your kitchen'));
  card.appendChild(body);

  card.addEventListener('click', () => openDetail(r.id));
  addLongPress(card, () => {
    boxActionTarget = r;
    qs('#box-action-title').textContent = r.title;
    openSheet('box-action-sheet', 'box-action-backdrop');
  });
  return card;
}

let boxActionTarget = null;
qs('#box-action-backdrop').addEventListener('click', () => closeSheet('box-action-sheet', 'box-action-backdrop'));
qs('#box-act-plan').addEventListener('click', () => {
  closeSheet('box-action-sheet', 'box-action-backdrop');
  if (boxActionTarget) openPlanPickerFor(boxActionTarget);
});
qs('#box-act-share').addEventListener('click', () => {
  closeSheet('box-action-sheet', 'box-action-backdrop');
  if (!boxActionTarget) return;
  state.shareTargetRecipe = boxActionTarget;
  openSheet('share-sheet', 'sheet-backdrop');
});
qs('#box-act-grocery').addEventListener('click', async () => {
  closeSheet('box-action-sheet', 'box-action-backdrop');
  const r = boxActionTarget;
  if (!r) return;
  for (const ing of (r.ingredients || [])) {
    const disp = ingredientDisplay(ing, 1);
    await addGroceryItem(disp.text, disp.amt, r.id);
  }
  toast(`${(r.ingredients || []).length} ingredients added to the list`);
});
qs('#box-act-delete').addEventListener('click', async () => {
  closeSheet('box-action-sheet', 'box-action-backdrop');
  const r = boxActionTarget;
  if (!r) return;
  if (!confirm(`Remove "${r.title}" from the recipe box? This is for the whole family and can't be undone.`)) return;
  const err = await deleteRecipeEverywhere(r);
  if (err) return toast(`Could not delete: ${err.message}`);
  toast('Removed');
  renderBox();
});

async function deleteRecipeEverywhere(r) {
  await supabase.from('favorites').delete().eq('recipe_id', r.id);
  await supabase.from('meal_plan').delete().eq('recipe_id', r.id);
  await supabase.from('grocery_items').update({ recipe_id: null }).eq('recipe_id', r.id);
  await supabase.from('recipes').update({ parent_recipe_id: null }).eq('parent_recipe_id', r.id);
  const { error } = await supabase.from('recipes').delete().eq('id', r.id);
  return error;
}

async function toggleFavorite(recipeId, btnEl) {
  if (!state.member?.id) return toast("Set up your profile first");
  const isFav = state.favorites.has(recipeId);
  if (isFav) {
    state.favorites.delete(recipeId);
    await supabase.from('favorites').delete().eq('member_id', state.member.id).eq('recipe_id', recipeId);
  } else {
    state.favorites.add(recipeId);
    await supabase.from('favorites').insert({ member_id: state.member.id, recipe_id: recipeId });
  }
  if (btnEl) btnEl.classList.toggle('active', !isFav);
}

qs('#search-input').addEventListener('input', (e) => { state.searchTerm = e.target.value; drawGrid(); });

/* ================= Recipe Detail (shared renderer: saved recipes + import previews) ================= */

async function openDetail(id) {
  const r = state.recipes.find(x => x.id === id) || (await supabase.from('recipes').select('*').eq('id', id).single()).data;
  renderRecipeDetail(r, { preview: false });
}

function openDraftPreview() {
  renderRecipeDetail(state.draft, { preview: true });
}

function renderRecipeDetail(r, { preview }) {
  state.currentRecipe = r;
  state.previewMode = preview;
  state.currentServings = r.servings || 4;
  showView('view-detail');

  qs('#detail-actions-normal').hidden = preview;
  qs('#detail-actions-normal-2').hidden = preview;
  qs('#btn-delete').hidden = preview;
  qs('#btn-save-box').hidden = preview || r.in_box !== false;
  qs('#detail-actions-preview').hidden = !preview;
  qs('#detail-share-icon').hidden = false;

  qs('#detail-hero').style.backgroundImage = r.image_url ? `url('${r.image_url}')` : 'none';
  qs('#detail-hero').style.display = r.image_url ? '' : 'none';
  qs('#detail-title').textContent = r.title;
  const ratingHtml = r.rating ? ` &nbsp;<span class="rating-line">★ ${Number(r.rating).toFixed(1)}${r.rating_count ? ` <span class="count">· ${r.rating_count} ratings</span>` : ''}</span>` : '';
  qs('#detail-source').innerHTML = (r.source_url
    ? `From <a href="${r.source_url}" target="_blank" rel="noopener">${r.source || 'the web'}</a>`
    : (r.source ? `From ${r.source}` : `Added by ${state.member.name}`)) + ratingHtml;
  qs('#detail-prep').textContent = r.prep_time || '–';
  qs('#detail-cook').textContent = r.cook_time || '–';
  qs('#detail-times').textContent = `${r.times_cooked || 0}×`;
  qs('#serv-value').textContent = state.currentServings;

  renderDetailIngredients();
  renderDetailSteps();
  renderDetailNotes();
  scrollMem['view-detail'] = 0;
  window.scrollTo(0, 0);
  pushNav({ v: 'detail' });
}

qs('#btn-save-box').addEventListener('click', async () => {
  const r = state.currentRecipe;
  await supabase.from('recipes').update({ in_box: true }).eq('id', r.id);
  r.in_box = true;
  qs('#btn-save-box').hidden = true;
  toast('It\'s a keeper — saved to your Recipe Box');
});

qs('#surprise-btn').addEventListener('click', () => {
  const boxRecipes = state.recipes.filter(r => r.in_box !== false);
  if (!boxRecipes.length) return toast('Add some recipes first!');
  // favorites count double so the family's loves come up more often
  const pool = [...boxRecipes, ...boxRecipes.filter(r => state.favorites.has(r.id))];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  toast('Tonight\'s pick…');
  setTimeout(() => openDetail(pick.id), 400);
});

qs('#btn-preview-edit').addEventListener('click', () => openEditor());
qs('#btn-preview-plan').addEventListener('click', async () => {
  const d = state.draft;
  if (!d.title) return toast('This one has no title — tap Edit details');
  try {
    const rec = await insertDraftAsRecipe(d, false);   // tryout: on the plan, not the box
    openPlanPickerFor(rec, { tryout: true });
  } catch (e) { toast('Could not save — try again'); }
});
qs('#detail-share-icon').addEventListener('click', () => {
  state.shareTargetRecipe = state.currentRecipe;
  openSheet('share-sheet', 'sheet-backdrop');
});
qs('#btn-preview-save').addEventListener('click', async () => {
  const d = state.draft;
  if (!d.title) return toast('This one has no title — tap Edit details');
  const { data, error } = await supabase.from('recipes').insert({
    title: d.title, source: d.source, source_url: d.source_url || null, image_url: d.image_url,
    servings: d.servings || 4, prep_time: d.prep_time, cook_time: d.cook_time,
    ingredients: d.ingredients || [], steps: d.steps || [], tags: d.tags || [],
    rating: d.rating || null, rating_count: d.rating_count || null,
    notes: attributeNote(d.notes || '', null) || '', created_by: state.member.id, parent_recipe_id: null,
  }).select().single();
  if (error) return toast('Could not save — try again');
  toast('Saved to your recipe box');
  await renderBox();
  openDetail(data.id);
});

qs('#btn-delete').addEventListener('click', async () => {
  const r = state.currentRecipe;
  if (!confirm(`Remove "${r.title}" from the recipe box? This is for the whole family and can't be undone.`)) return;
  const err = await deleteRecipeEverywhere(r);
  if (err) return toast(`Could not delete: ${err.message}`);
  toast('Removed');
  setTab('box');
});

function renderDetailIngredients() {
  const r = state.currentRecipe;
  const scale = state.currentServings / (r.servings || state.currentServings || 1);
  const box = qs('#detail-ingredients');
  box.innerHTML = '';
  (r.ingredients || []).forEach((ing, i) => {
    const disp = ingredientDisplay(ing, scale);
    const row = el('div', 'ingredient-row');
    row.innerHTML = `<div class="check-circle" data-i="${i}"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
      <div class="amt">${disp.amt}</div><div class="txt">${disp.text}</div>`;
    row.querySelector('.check-circle').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('checked');
      updateGroceryBtnLabel();
    });
    box.appendChild(row);
  });
  updateGroceryBtnLabel();
}

function updateGroceryBtnLabel() {
  const n = qsa('#detail-ingredients .check-circle.checked').length;
  qs('#add-all-grocery').textContent = n ? `+ Add ${n} to list` : '+ Add all to list';
}

function renderDetailSteps() {
  const r = state.currentRecipe;
  const box = qs('#detail-steps');
  box.innerHTML = '';
  (r.steps || []).forEach((s, i) => {
    const row = el('div', 'step-row');
    row.innerHTML = `<div class="step-num">${i + 1}</div><div class="step-text">${s}</div>`;
    box.appendChild(row);
  });
}

function renderDetailNotes() {
  const r = state.currentRecipe;
  const label = qs('#notes-label');
  const box = qs('#detail-notes');
  box.innerHTML = '';
  const lines = (r.notes || '').split('\n').map(s => s.trim()).filter(Boolean);
  label.hidden = !lines.length;
  lines.forEach(line => box.appendChild(el('div', 'note-card', line)));
}

function memberNameFor(r) {
  const m = state.members.find(x => x.id === r.created_by);
  return m ? m.name : 'A note';
}

qs('#detail-back').addEventListener('click', () => history.back());
qs('#serv-plus').addEventListener('click', () => { state.currentServings++; qs('#serv-value').textContent = state.currentServings; renderDetailIngredients(); });
qs('#serv-minus').addEventListener('click', () => { if (state.currentServings > 1) state.currentServings--; qs('#serv-value').textContent = state.currentServings; renderDetailIngredients(); });

qs('#add-all-grocery').addEventListener('click', async () => {
  const r = state.currentRecipe;
  const scale = state.currentServings / (r.servings || state.currentServings || 1);
  const circles = qsa('#detail-ingredients .check-circle');
  const selectedIdx = circles.filter(c => c.classList.contains('checked')).map(c => parseInt(c.dataset.i));
  const ings = (r.ingredients || []).filter((_, i) => !selectedIdx.length || selectedIdx.includes(i));
  for (const ing of ings) {
    const disp = ingredientDisplay(ing, scale);
    await addGroceryItem(disp.text, disp.amt, r.id || null);
  }
  circles.forEach(c => c.classList.remove('checked'));
  updateGroceryBtnLabel();
  toast(`${ings.length} added to grocery list`);
});

/* ---- Edit / remix (updates the recipe in place) ---- */
qs('#btn-remix').addEventListener('click', () => {
  const r = state.currentRecipe;
  state.draft = JSON.parse(JSON.stringify(r));
  state.draftMode = 'edit';
  state.parentForRemix = null;
  openEditor();
});

/* ---- Cook mode ---- */
qs('#btn-cook').addEventListener('click', () => {
  const r = state.currentRecipe;
  if (!r.steps?.length) return toast('No steps to cook yet');
  state.cookRecipe = r;
  state.cookIndex = 0;
  showCookStep();
  qs('#cook-mode').hidden = false;
  r.times_cooked = (r.times_cooked || 0) + 1;
  qs('#detail-times').textContent = `${r.times_cooked}×`;
  supabase.from('recipes').update({ times_cooked: r.times_cooked }).eq('id', r.id).then(() => {});
});
qs('#cook-close').addEventListener('click', () => { qs('#cook-mode').hidden = true; clearInterval(state.timerInterval); });
qs('#cook-next').addEventListener('click', () => {
  if (state.cookIndex < state.cookRecipe.steps.length - 1) { state.cookIndex++; showCookStep(); }
  else {
    qs('#cook-mode').hidden = true;
    clearInterval(state.timerInterval);
    qs('#cooked-note').value = '';
    openSheet('cooked-sheet', 'cooked-sheet-backdrop');
  }
});

qs('#cooked-skip').addEventListener('click', () => closeSheet('cooked-sheet', 'cooked-sheet-backdrop'));
qs('#cooked-sheet-backdrop').addEventListener('click', () => closeSheet('cooked-sheet', 'cooked-sheet-backdrop'));
qs('#cooked-save').addEventListener('click', async () => {
  const note = qs('#cooked-note').value.trim();
  closeSheet('cooked-sheet', 'cooked-sheet-backdrop');
  if (!note) return;
  const r = state.cookRecipe;
  const dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const entry = `${note} (${state.member.name}, ${dateStr})`;
  r.notes = r.notes ? `${r.notes}\n${entry}` : entry;
  await supabase.from('recipes').update({ notes: r.notes }).eq('id', r.id);
  if (state.currentRecipe?.id === r.id) renderDetailNotes();
  toast('Note saved to the recipe');
});
qs('#cook-prev').addEventListener('click', () => { if (state.cookIndex > 0) { state.cookIndex--; showCookStep(); } });

function showCookStep() {
  clearInterval(state.timerInterval);
  const steps = state.cookRecipe.steps;
  qs('#cook-step-num').textContent = `Step ${state.cookIndex + 1} of ${steps.length}`;
  qs('#cook-step-text').textContent = steps[state.cookIndex];
  qs('#cook-next').textContent = state.cookIndex === steps.length - 1 ? 'Finish' : 'Next';
  const secs = timerSecondsFromStep(steps[state.cookIndex]);
  const chip = qs('#cook-timer');
  const native = qs('#cook-timer-native');
  const isAndroid = /android/i.test(navigator.userAgent);
  if (secs) {
    chip.hidden = false;
    chip.textContent = `⏱ Start ${Math.round(secs/60) || 1} min timer`;
    chip.onclick = () => startTimer(secs, chip);
    native.hidden = !isAndroid;
    if (isAndroid) {
      native.onclick = () => {
        const msg = encodeURIComponent(state.cookRecipe.title.slice(0, 40));
        window.location.href = `intent://timer#Intent;action=android.intent.action.SET_TIMER;i.android.intent.extra.alarm.LENGTH=${secs};S.android.intent.extra.alarm.MESSAGE=${msg};B.android.intent.extra.alarm.SKIP_UI=true;end`;
      };
    }
  } else {
    chip.hidden = true;
    native.hidden = true;
  }
}

function startTimer(seconds, chip) {
  clearInterval(state.timerInterval);
  let remaining = seconds;
  const tick = () => {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    chip.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;
    if (remaining <= 0) {
      clearInterval(state.timerInterval);
      chip.textContent = '⏱ Time\'s up!';
      if (navigator.vibrate) navigator.vibrate([200,100,200,100,200]);
      beep();
      toast("Time's up!");
      return;
    }
    remaining--;
  };
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0,1,2].forEach(i => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.15, t);
      o.start(t); o.stop(t + 0.25);
    });
  } catch (e) {}
}

/* ---- Share sheet ---- */
function openSheet(id, backdropId) { qs('#' + backdropId).classList.add('show'); qs('#' + id).classList.add('show'); }
function closeSheet(id, backdropId) { qs('#' + backdropId).classList.remove('show'); qs('#' + id).classList.remove('show'); }

qs('#btn-share').addEventListener('click', () => { state.shareTargetRecipe = state.currentRecipe; openSheet('share-sheet', 'sheet-backdrop'); });
qs('#sheet-backdrop').addEventListener('click', () => closeSheet('share-sheet', 'sheet-backdrop'));

function shareText(r) {
  let t = `${r.title}${r.source ? ` (via ${r.source})` : ''}\n\n`;
  t += 'Ingredients:\n' + (r.ingredients || []).map(i => `• ${i.raw || [i.amount, i.unit, i.item].filter(Boolean).join(' ')}`).join('\n');
  t += '\n\nSteps:\n' + (r.steps || []).map((s, i) => `${i+1}. ${s}`).join('\n');
  if (r.source_url) t += `\n\nFull recipe: ${r.source_url}`;
  return t;
}

qs('#share-whatsapp').addEventListener('click', () => {
  const text = shareText(state.shareTargetRecipe);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  closeSheet('share-sheet', 'sheet-backdrop');
});
qs('#share-sms').addEventListener('click', () => {
  const text = shareText(state.shareTargetRecipe);
  window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
  closeSheet('share-sheet', 'sheet-backdrop');
});
qs('#share-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(shareText(state.shareTargetRecipe));
  toast('Copied to clipboard');
  closeSheet('share-sheet', 'sheet-backdrop');
});

/* ================= Import ================= */

qs('#fab-add').addEventListener('click', () => { showView('view-import'); pushNav({ v: 'import' }); qs('#import-status').hidden = true; qs('#import-url').value = ''; });
qs('#import-back').addEventListener('click', () => history.back());
qs('#import-manual').addEventListener('click', () => {
  state.draft = { title: '', source: '', source_url: '', image_url: '', servings: 4, prep_time: '', cook_time: '', ingredients: [], steps: [], notes: '' };
  state.draftMode = 'manual';
  state.parentForRemix = null;
  openEditor();
});

async function callImportFn(payload) {
  const resp = await fetch(IMPORT_RECIPE_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Request failed');
  return data;
}

async function importFromUrl(url, statusEl, { open = true } = {}) {
  if (statusEl) { statusEl.hidden = false; statusEl.innerHTML = `<div class="spinner"></div> Fetching and reading the recipe…`; }
  const data = await callImportFn({ url });
  state.draft = {
    title: data.title || '',
    source: data.source || new URL(url).hostname.replace('www.', ''),
    source_url: url,
    image_url: data.image_url || '',
    servings: data.servings || 4,
    prep_time: data.prep_time || '',
    cook_time: data.cook_time || '',
    ingredients: (data.ingredients || []).map(parseIngredientLine),
    steps: data.steps || [],
    tags: data.tags || [],
    rating: data.rating || null,
    rating_count: data.rating_count || null,
    notes: '',
  };
  state.draftMode = 'import';
  state.parentForRemix = null;
  if (statusEl) statusEl.hidden = true;
  if (open) openDraftPreview();
  return state.draft;
}

async function insertDraftAsRecipe(d, inBox) {
  const { data, error } = await supabase.from('recipes').insert({
    title: d.title, source: d.source, source_url: d.source_url || null, image_url: d.image_url,
    servings: d.servings || 4, prep_time: d.prep_time, cook_time: d.cook_time,
    ingredients: d.ingredients || [], steps: d.steps || [], tags: d.tags || [],
    rating: d.rating || null, rating_count: d.rating_count || null,
    notes: d.notes || '', created_by: state.member.id, parent_recipe_id: state.parentForRemix,
    in_box: inBox,
  }).select().single();
  if (error) throw new Error('save failed');
  return data;
}

qs('#import-go').addEventListener('click', async () => {
  const url = qs('#import-url').value.trim();
  if (!url) return;
  const status = qs('#import-status');
  try {
    await importFromUrl(url, status);
  } catch (err) {
    status.hidden = false;
    status.innerHTML = `Couldn't auto-import that link (${err.message}). You can still <button class="btn-ghost" id="fallback-manual" style="padding:0;">paste the ingredients and steps by hand</button>.`;
    qs('#fallback-manual')?.addEventListener('click', () => qs('#import-manual').click());
  }
});

/* ================= Discover ================= */

const DISCOVER_CATS = ['Chicken','Pasta','30-Minute','Seafood','Beef','Pork','Vegetarian','Soup','Salad','Slow Cooker','Casserole','Tacos','Stir Fry','Dessert','Breakfast'];
const disc = {
  mode: 'feed', query: '', page: 1, busy: false, done: false, started: false,
  seed: Math.floor(Math.random() * 200),   // per-session: dig into a different slice of each archive
  sources: [],                              // selected hosts; empty = all
  allSites: [],
  seenUrls: new Set(),
};

// Learn the family's taste from the recipe box: frequent meaningful words
// in saved titles/tags become search terms mixed into the feed.
const STOPWORDS = new Set(['with','and','the','best','easy','quick','recipe','recipes','from','style','baked','simple','homemade','classic','perfect','minute','version','skillet','sheet','pan','one','pot']);
function learnedInterests() {
  const counts = {};
  state.recipes.filter(r => r.in_box !== false).forEach(r => {
    const words = (r.title + ' ' + (r.tags || []).join(' ')).toLowerCase().split(/[^a-z]+/);
    words.forEach(w => { if (w.length > 3 && !STOPWORDS.has(w)) counts[w] = (counts[w] || 0) + 1; });
  });
  const ranked = Object.entries(counts).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 6);
  // pick up to 2 at random each session so the mix rotates
  const picks = [];
  while (ranked.length && picks.length < 2) picks.push(ranked.splice(Math.floor(Math.random() * ranked.length), 1)[0]);
  return picks;
}

function addLongPress(elem, onLong) {
  let timer = null, fired = false, sx = 0, sy = 0;
  elem.addEventListener('pointerdown', (e) => {
    fired = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(15); onLong(); }, 500);
  });
  const cancel = () => clearTimeout(timer);
  elem.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancel(); });
  elem.addEventListener('pointerup', cancel);
  elem.addEventListener('pointercancel', cancel);
  elem.addEventListener('contextmenu', (e) => e.preventDefault());
  elem.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

let discActionTarget = null;

function discoverCard(r) {
  const card = el('div', 'recipe-card');
  const thumb = el('div', 'thumb');
  if (r.image) thumb.style.backgroundImage = `url('${r.image}')`;
  else thumb.textContent = r.title[0] || '?';
  card.appendChild(thumb);
  const body = el('div', 'body');
  body.appendChild(el('h3', null, r.title));
  body.appendChild(el('div', 'source', r.source));
  if (r.rating) body.appendChild(el('div', 'rating-line', `★ ${Number(r.rating).toFixed(1)}${r.rating_count ? ` <span class="count">(${r.rating_count})</span>` : ''}`));
  card.appendChild(body);
  card.addEventListener('click', async () => {
    const status = qs('#discover-status');
    try {
      await importFromUrl(r.url, status);
      state.draft.source = r.source || state.draft.source;
    } catch (err) {
      status.hidden = true;
      if (/No recipe data/.test(err.message)) {
        toast('Not a single recipe — opening the page instead');
        window.open(r.url, '_blank');
      } else {
        status.hidden = false;
        status.textContent = `Couldn't import that one (${err.message}) — try another.`;
      }
    }
  });
  addLongPress(card, () => {
    discActionTarget = r;
    qs('#disc-action-title').textContent = r.title;
    qs('#disc-action-source').textContent = r.source || '';
    openSheet('disc-action-sheet', 'disc-action-backdrop');
  });
  return card;
}

qs('#disc-action-backdrop').addEventListener('click', () => closeSheet('disc-action-sheet', 'disc-action-backdrop'));

qs('#disc-act-open').addEventListener('click', () => {
  closeSheet('disc-action-sheet', 'disc-action-backdrop');
  if (discActionTarget) importFromUrl(discActionTarget.url, qs('#discover-status')).catch(() => toast('Could not open that one'));
});

qs('#disc-act-save').addEventListener('click', async () => {
  closeSheet('disc-action-sheet', 'disc-action-backdrop');
  if (!discActionTarget) return;
  toast('Saving…');
  try {
    const d = await importFromUrl(discActionTarget.url, null, { open: false });
    d.source = discActionTarget.source || d.source;
    await insertDraftAsRecipe(d, true);
    toast('Saved to your Recipe Box');
  } catch (e) { toast('Could not import that one'); }
});

qs('#disc-act-plan').addEventListener('click', async () => {
  closeSheet('disc-action-sheet', 'disc-action-backdrop');
  if (!discActionTarget) return;
  toast('Fetching recipe…');
  try {
    const d = await importFromUrl(discActionTarget.url, null, { open: false });
    d.source = discActionTarget.source || d.source;
    const rec = await insertDraftAsRecipe(d, false);   // tryout: on the plan, not in the box
    openPlanPickerFor(rec, { tryout: true });
  } catch (e) { toast('Could not import that one'); }
});

/* ---- filter sheets ---- */

async function loadSiteList() {
  if (disc.allSites.length) return;
  try { disc.allSites = (await callImportFn({ sites: true })).sites || []; } catch (e) { disc.allSites = []; }
}

qs('#filter-sources-btn').addEventListener('click', async () => {
  await loadSiteList();
  const list = qs('#sources-chip-list');
  list.innerHTML = '';
  disc.allSites.forEach(s => {
    const c = el('button', 'chip' + (disc.sources.includes(s.host) ? ' active' : ''), s.name);
    c.dataset.host = s.host;
    c.addEventListener('click', () => c.classList.toggle('active'));
    list.appendChild(c);
  });
  openSheet('sources-sheet', 'sources-sheet-backdrop');
});
qs('#sources-sheet-backdrop').addEventListener('click', () => closeSheet('sources-sheet', 'sources-sheet-backdrop'));
qs('#sources-clear').addEventListener('click', () => qsa('#sources-chip-list .chip').forEach(c => c.classList.remove('active')));
qs('#sources-apply').addEventListener('click', () => {
  disc.sources = qsa('#sources-chip-list .chip.active').map(c => c.dataset.host);
  const btn = qs('#filter-sources-btn');
  btn.textContent = disc.sources.length ? `Sources · ${disc.sources.length} ▾` : 'Sources · All ▾';
  btn.classList.toggle('active', !!disc.sources.length);
  closeSheet('sources-sheet', 'sources-sheet-backdrop');
  disc.query ? runDiscoverSearch(true) : resetToFeed();
});

qs('#filter-cat-btn').addEventListener('click', () => {
  const list = qs('#cat-chip-list');
  if (!list.children.length) {
    DISCOVER_CATS.forEach(cat => {
      const c = el('button', 'chip', cat);
      c.addEventListener('click', () => {
        closeSheet('cat-sheet', 'cat-sheet-backdrop');
        qs('#discover-input').value = cat;
        qs('#filter-cat-btn').textContent = `${cat} ▾`;
        qs('#filter-cat-btn').classList.add('active');
        runDiscoverSearch(true);
      });
      list.appendChild(c);
    });
  }
  openSheet('cat-sheet', 'cat-sheet-backdrop');
});
qs('#cat-sheet-backdrop').addEventListener('click', () => closeSheet('cat-sheet', 'cat-sheet-backdrop'));

/* ---- fetching ---- */

async function fetchDiscoverPage() {
  if (disc.busy || disc.done) return;
  disc.busy = true;
  const more = qs('#discover-more-status');
  if (disc.page > 1) more.hidden = false;
  try {
    const base = disc.mode === 'search'
      ? { search: disc.query, page: disc.page }
      : { feed: true, page: disc.page, seed: disc.seed, interests: learnedInterests() };
    if (disc.sources.length) base.sources = disc.sources;
    const data = await callImportFn(base);
    const results = (data.results || []).filter(r => !disc.seenUrls.has(r.url));
    results.forEach(r => disc.seenUrls.add(r.url));
    const box = disc.mode === 'search' ? qs('#discover-results') : qs('#discover-feed');
    const rendered = [];
    results.forEach(r => {
      const card = discoverCard(r);
      box.appendChild(card);
      rendered.push({ r, card });
    });
    if (disc.mode === 'feed') {
      disc.cacheResults = [...(disc.cacheResults || []), ...results];
    }
    lazyRatings(rendered).then(() => { if (disc.mode === 'feed') saveDiscCache(); });   // cache after ratings fill so reopen has stars too
    if (disc.mode === 'feed') saveDiscCache();
    if (disc.page === 1) {
      qs('#discover-results-label').hidden = !(disc.mode === 'search' && results.length);
      qs('#discover-feed-label').hidden = !(disc.mode === 'feed' && results.length);
      if (disc.mode === 'search' && !results.length) {
        const s = qs('#discover-status');
        s.hidden = false;
        s.textContent = `No results for "${disc.query}" — try a simpler term, like one main ingredient.`;
      }
    }
    if (!results.length && !(data.results || []).length) disc.done = true;
    disc.page++;
  } catch (err) {
    if (disc.page === 1) {
      const s = qs('#discover-status');
      s.hidden = false;
      s.textContent = `Search hit a snag (${err.message}). Try again in a moment.`;
    }
    disc.done = true;
  } finally {
    disc.busy = false;
    more.hidden = true;
  }
}

async function lazyRatings(rendered) {
  const pending = rendered.filter(x => !x.r.rating);
  for (let i = 0; i < pending.length; i += 10) {
    const chunk = pending.slice(i, i + 10);
    try {
      const res = await callImportFn({ ratings: chunk.map(x => x.r.url) });
      chunk.forEach(x => {
        const info = res.ratings?.[x.r.url];
        if (info?.rating && x.card.isConnected) {
          x.r.rating = info.rating;
          x.r.rating_count = info.rating_count;
          x.card.querySelector('.body').appendChild(
            el('div', 'rating-line', `★ ${Number(info.rating).toFixed(1)}${info.rating_count ? ` <span class="count">(${info.rating_count})</span>` : ''}`)
          );
        }
      });
    } catch (e) { break; }
  }
}

function resetDiscover(mode, query) {
  disc.mode = mode; disc.query = query || ''; disc.page = 1; disc.done = false; disc.busy = false;
  disc.seenUrls.clear();
  qs('#discover-results').innerHTML = '';
  qs('#discover-results-label').hidden = true;
  qs('#discover-status').hidden = true;
  if (mode === 'search') {
    qs('#discover-feed').innerHTML = '';
    qs('#discover-feed-label').hidden = true;
  } else {
    qs('#filter-cat-btn').textContent = 'Category ▾';
    qs('#filter-cat-btn').classList.remove('active');
  }
}

function resetToFeed() {
  resetDiscover('feed');
  qs('#discover-feed').innerHTML = '';
  disc.cacheResults = [];
  qs('#discover-feed-label').textContent = learnedInterests().length ? 'Dinner ideas, inspired by your recipe box' : 'Dinner ideas for your table';
  const s = qs('#discover-status');
  s.hidden = false;
  s.innerHTML = `<div class="spinner"></div> Finding tonight's dinner contenders…`;
  fetchDiscoverPage().then(() => { if (qs('#discover-feed').children.length) s.hidden = true; });
}

function saveDiscCache() {
  if (disc.mode !== 'feed') return;
  try {
    localStorage.setItem('rb_disc_cache', JSON.stringify({ date: todayISO(), seed: disc.seed, page: disc.page, results: disc.cacheResults || [] }));
  } catch (e) {}
}

async function initDiscover() {
  if (disc.started) return;
  disc.started = true;
  // same-day cache: reopening later shows the same feed instantly; tomorrow is fresh
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('rb_disc_cache') || 'null'); } catch (e) {}
  if (cached && cached.date === todayISO() && cached.results?.length) {
    disc.seed = cached.seed;
    disc.page = cached.page;
    disc.cacheResults = cached.results;
    const box = qs('#discover-feed');
    const rendered = [];
    cached.results.forEach(r => {
      disc.seenUrls.add(r.url);
      const card = discoverCard(r);
      box.appendChild(card);
      rendered.push({ r, card });
    });
    qs('#discover-feed-label').textContent = 'Dinner ideas for your table';
    qs('#discover-feed-label').hidden = false;
    lazyRatings(rendered);
  } else {
    disc.cacheResults = [];
    resetToFeed();
  }
  const sentinel = qs('#discover-sentinel');
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !qs('#view-discover').hidden) fetchDiscoverPage();
  }, { rootMargin: '400px' }).observe(sentinel);
}

async function runDiscoverSearch(keepCat) {
  const q = qs('#discover-input').value.trim();
  if (!q) return;
  if (!keepCat) { qs('#filter-cat-btn').textContent = 'Category ▾'; qs('#filter-cat-btn').classList.remove('active'); }
  resetDiscover('search', q);
  const status = qs('#discover-status');
  status.hidden = false;
  status.innerHTML = `<div class="spinner"></div> Searching your favorite sites…`;
  await fetchDiscoverPage();
  if (qs('#discover-results').children.length) status.hidden = true;
}

qs('#discover-go').addEventListener('click', () => runDiscoverSearch());
qs('#discover-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); runDiscoverSearch(); } });
qs('#discover-paste-link').addEventListener('click', () => { showView('view-import'); pushNav({ v: 'import' }); qs('#import-status').hidden = true; });

/* ================= Editor (import preview / manual / remix) ================= */

function openEditor() {
  const d = state.draft;
  qs('#editor-heading').textContent = state.draftMode === 'edit' ? 'Edit recipe' : state.draftMode === 'import' ? 'Review recipe' : 'Add a recipe';
  qs('#ed-title').value = d.title || '';
  qs('#ed-source').value = d.source || '';
  qs('#ed-image').value = d.image_url || '';
  qs('#ed-servings').value = d.servings || 4;
  qs('#ed-prep').value = d.prep_time || '';
  qs('#ed-cook').value = d.cook_time || '';
  qs('#ed-note-label').textContent = state.draftMode === 'edit' ? 'Notes — what did you change?' : 'Note (optional)';
  qs('#ed-note').value = d.notes || '';

  const ingBox = qs('#ed-ingredients'); ingBox.innerHTML = '';
  (d.ingredients || []).forEach(ing => addEditorRow(ingBox, ing.raw || [ing.amount, ing.unit, ing.item].filter(Boolean).join(' ')));
  if (!d.ingredients?.length) addEditorRow(ingBox, '');

  const stepBox = qs('#ed-steps'); stepBox.innerHTML = '';
  (d.steps || []).forEach(s => addEditorRow(stepBox, s, true));
  if (!d.steps?.length) addEditorRow(stepBox, '', true);

  showView('view-editor');
  pushNav({ v: 'editor' });
}

function addEditorRow(container, value, multiline) {
  const row = el('div', 'row');
  const input = el(multiline ? 'textarea' : 'input');
  input.value = value || '';
  if (multiline) input.rows = 2;
  const rm = el('button', 'remove-row', '✕');
  rm.addEventListener('click', () => row.remove());
  row.appendChild(input); row.appendChild(rm);
  container.appendChild(row);
}

qs('#add-ingredient-row').addEventListener('click', () => addEditorRow(qs('#ed-ingredients'), ''));
qs('#add-step-row').addEventListener('click', () => addEditorRow(qs('#ed-steps'), '', true));
qs('#editor-back').addEventListener('click', () => {
  if (state.draftMode === 'import') openDraftPreview();
  else history.back();
});

function attributeNote(note, previous) {
  // sign new/changed notes with the author's name so the handwritten cards say who wrote them
  if (!note || note === previous) return note;
  const lines = note.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map(l => (/[—(]/.test(l.slice(-14)) || l.includes('—')) ? l : `${l} — ${state.member.name}`).join('\n');
}

qs('#ed-save').addEventListener('click', async () => {
  const title = qs('#ed-title').value.trim();
  if (!title) return toast('Give it a title first');
  const ingredients = qsa('#ed-ingredients input').map(i => i.value.trim()).filter(Boolean).map(parseIngredientLine);
  const steps = qsa('#ed-steps textarea, #ed-steps input').map(i => i.value.trim()).filter(Boolean);

  const payload = {
    title,
    source: qs('#ed-source').value.trim(),
    source_url: state.draft.source_url || null,
    image_url: qs('#ed-image').value.trim(),
    servings: parseInt(qs('#ed-servings').value) || 4,
    prep_time: qs('#ed-prep').value.trim(),
    cook_time: qs('#ed-cook').value.trim(),
    ingredients,
    steps,
    tags: state.draft.tags || [],
    rating: state.draft.rating || null,
    rating_count: state.draft.rating_count || null,
    notes: attributeNote(qs('#ed-note').value.trim(), state.draft.notes),
  };

  if (state.draftMode === 'edit' && state.draft.id) {
    const { error } = await supabase.from('recipes').update(payload).eq('id', state.draft.id);
    if (error) return toast('Could not save — try again');
    toast('Recipe updated');
    await renderBox();
    openDetail(state.draft.id);
    return;
  }

  payload.created_by = state.member.id;
  payload.parent_recipe_id = null;
  const { data, error } = await supabase.from('recipes').insert(payload).select().single();
  if (error) return toast('Could not save — try again');
  toast('Saved to your recipe box');
  await renderBox();
  openDetail(data.id);
});

/* ================= Grocery List ================= */

const STARTER_STAPLES = ['Eggs', 'Milk', 'Bread', 'Bananas', 'Butter', 'Cereal', 'Coffee', 'Fruit'];

async function loadGrocery() {
  const { data } = await supabase.from('grocery_items').select('*, recipes(title)').order('created_at', { ascending: true });
  state.groceryItems = data || [];
  // learn frequent buys from the last 90 days (survives list clearing)
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: hist } = await supabase.from('grocery_history').select('item').gte('added_at', since) || {};
  const counts = {};
  // grocery_history doesn't currently store who added an item (no added_by column), so chips
  // aren't attributable yet — h.added_by is undefined today. If that column gets added later,
  // this starts populating state.quickAddBy automatically and drawGrocery() will show badges.
  const lastAddedBy = {};
  (hist || []).forEach(h => {
    const k = h.item.trim().toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
    if (h.added_by) lastAddedBy[k] = h.added_by;
  });
  const frequent = Object.entries(counts).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
  state.quickAdd = [...new Set([...frequent, ...STARTER_STAPLES])].slice(0, 8);
  state.quickAddBy = lastAddedBy;
  drawGrocery();
}

function drawGrocery() {
  const content = qs('#grocery-content');
  content.innerHTML = '';
  qs('#grocery-empty').hidden = state.groceryItems.length > 0;

  // Quick add — one-tap staples
  const onList = new Set(state.groceryItems.filter(i => !i.checked).map(i => i.item.trim().toLowerCase()));
  const quick = (state.quickAdd || []).filter(q => !onList.has(q.toLowerCase()));
  if (quick.length) {
    content.appendChild(el('div', 'cat-label', 'Quick add'));
    const row = el('div', 'chip-wrap');
    quick.forEach(q => {
      const c = el('button', 'chip', `+ ${q}`);
      const attributedId = (state.quickAddBy || {})[q.toLowerCase()];
      const badge = attributedId ? memberBadge(attributedId) : null;
      if (badge) { badge.classList.add('member-badge-chip'); c.appendChild(badge); }
      c.addEventListener('click', async () => { await addGroceryItem(q, null, null); drawGrocery(); });
      row.appendChild(c);
    });
    content.appendChild(row);
  }

  if (state.groceryItems.length) {
    const done = state.groceryItems.filter(i => i.checked).length;
    const prog = el('div', 'grocery-progress',
      `<div class="count">${done} of ${state.groceryItems.length} in the cart</div><div class="bar"><div style="width:${Math.round(done / state.groceryItems.length * 100)}%;"></div></div>`);
    content.appendChild(prog);
    // which recipes this list covers
    const titles = {};
    state.groceryItems.forEach(i => { const t = i.recipes?.title; if (t) titles[t] = (titles[t] || 0) + 1; });
    const names = Object.keys(titles);
    if (names.length) {
      const row = el('div', 'chip-wrap');
      row.style.marginTop = '10px';
      names.forEach(t => row.appendChild(el('span', 'chip', `🍳 ${t}`)));
      content.appendChild(row);
    }
  }
  const byCat = {};
  state.groceryItems.forEach(item => {
    const cat = item.category || categorize(item.item);
    (byCat[cat] = byCat[cat] || []).push(item);
  });
  const order = ['Produce','Meat & Seafood','Dairy & Eggs','Bakery','Pantry','Frozen','Other'];
  order.filter(c => byCat[c]?.length).forEach(cat => {
    const section = el('div', 'grocery-section');
    section.appendChild(el('div', 'cat-label', cat));
    byCat[cat].sort((a,b) => a.checked - b.checked).forEach(item => section.appendChild(groceryRow(item)));
    content.appendChild(section);
  });
  const btnRow = el('div', 'action-row');
  if (state.groceryItems.some(i => i.checked)) {
    const clearBtn = el('button', 'btn btn-ghost', 'Clear checked');
    clearBtn.addEventListener('click', async () => {
      const ids = state.groceryItems.filter(i => i.checked).map(i => i.id);
      await supabase.from('grocery_items').delete().in('id', ids);
      loadGrocery();
    });
    btnRow.appendChild(clearBtn);
  }
  if (state.groceryItems.length) {
    const clearAll = el('button', 'btn btn-ghost', 'Clear all');
    clearAll.style.color = 'var(--color-danger)';
    clearAll.addEventListener('click', async () => {
      if (!confirm('Clear the entire grocery list for everyone?')) return;
      const ids = state.groceryItems.map(i => i.id);
      await supabase.from('grocery_items').delete().in('id', ids);
      loadGrocery();
    });
    btnRow.appendChild(clearAll);
  }
  if (btnRow.children.length) content.appendChild(btnRow);
}

function groceryRow(item) {
  const row = el('div', 'grocery-row' + (item.checked ? ' checked' : ''));
  row.innerHTML = `<div class="check-circle${item.checked ? ' checked' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
    <div class="txt">${item.item}</div>
    ${item.amount ? `<div class="amt">${item.amount}</div>` : ''}`;
  const badge = memberBadge(item.added_by);
  if (badge) row.appendChild(badge);
  row.querySelector('.check-circle').addEventListener('click', async (e) => {
    const next = !item.checked;
    item.checked = next;
    e.currentTarget.classList.toggle('checked', next);
    row.classList.toggle('checked', next);
    await supabase.from('grocery_items').update({ checked: next }).eq('id', item.id);
    drawGrocery();
  });
  return row;
}

function normUnit(u) {
  u = (u || '').toLowerCase().replace(/[.,]/g, '');
  const map = { cups:'cup', tablespoons:'tbsp', tablespoon:'tbsp', teaspoons:'tsp', teaspoon:'tsp', pounds:'lb', lbs:'lb', pound:'lb', ounces:'oz', ounce:'oz', grams:'g', gram:'g', cloves:'clove', cans:'can', slices:'slice', bunches:'bunch' };
  return map[u] || u;
}

function parseAmtString(s) {
  if (!s) return { qty: null, unit: '' };
  let qty = 0, found = false, unit = '';
  s.trim().split(/\s+/).forEach(tok => {
    if (UNICODE_FRAC[tok] !== undefined) { qty += UNICODE_FRAC[tok]; found = true; }
    else if (/^\d+\/\d+$/.test(tok)) { const [a, b] = tok.split('/'); qty += parseInt(a) / parseInt(b); found = true; }
    else if (/^\d*\.?\d+$/.test(tok)) { qty += parseFloat(tok); found = true; }
    else if (/^[a-zA-Z]+$/.test(tok)) unit = normUnit(tok);
  });
  return { qty: found ? qty : null, unit };
}

async function addGroceryItem(name, amount, recipeId) {
  // clean up scraped ingredient text before it ever touches the DB — this table is shared
  // with Hearth's UI now, so messy "few sprigs rosemary (or thyme, sage)"-style text shows
  // up there too. Any genuine substitution/brand note gets folded into amount instead.
  const { item: cleanName, note } = cleanGroceryItemText(name);
  if (note) amount = amount ? `${amount} (${note})` : `(${note})`;
  name = cleanName;

  // merge with an existing unchecked line for the same item
  const key = name.trim().toLowerCase();
  const existing = state.groceryItems.find(i => !i.checked && i.item.trim().toLowerCase() === key);
  if (existing) {
    let newAmt;
    const a = parseAmtString(existing.amount), b = parseAmtString(amount);
    const xMatch = (existing.amount || '').match(/^×(\d+)$/);
    if (a.qty != null && b.qty != null && a.unit === b.unit) {
      newAmt = `${formatAmount(a.qty + b.qty)}${a.unit ? ' ' + a.unit : ''}`;
    } else if (!existing.amount && !amount) {
      newAmt = '×2';
    } else if (xMatch && !amount) {
      newAmt = `×${parseInt(xMatch[1]) + 1}`;
    } else {
      newAmt = [existing.amount, amount].filter(Boolean).join(' + ');
    }
    existing.amount = newAmt;
    await supabase.from('grocery_items').update({ amount: newAmt }).eq('id', existing.id);
    supabase.from('grocery_history').insert({ item: name }).then(() => {});
    return;
  }
  const { data } = await supabase.from('grocery_items').insert({
    item: name, amount: amount || null, added_by: state.member?.id || null, recipe_id: recipeId || null,
    category: categorize(name),
  }).select().single();
  if (data) state.groceryItems.push(data);
  // history log powers Quick Add suggestions; fail-soft if migration not run yet
  supabase.from('grocery_history').insert({ item: name }).then(() => {});
}

qs('#grocery-add-btn').addEventListener('click', async () => {
  const input = qs('#grocery-add-input');
  const val = input.value.trim();
  if (!val) return;
  await addGroceryItem(val, null, null);
  input.value = '';
  drawGrocery();
});
qs('#grocery-add-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') qs('#grocery-add-btn').click(); });

/* ================= Meal Plan (rolling days + history) ================= */

const plan = { startOffset: 0, endOffset: 4 };   // today .. today+4 by default

function visiblePlanDays() {
  const days = [];
  for (let o = plan.startOffset; o <= plan.endOffset; o++) days.push(todayISO(o));
  return days;
}

async function loadPlan() {
  const days = visiblePlanDays();
  const { data } = await supabase.from('meal_plan').select('*, recipes(*)')
    .gte('planned_date', days[0]).lte('planned_date', days[days.length - 1]);
  state.planEntries = {};
  (data || []).forEach(row => { state.planEntries[row.planned_date] = row; });
  drawPlan();
}

qs('#fill-plan').addEventListener('click', async () => {
  const emptyDays = visiblePlanDays().filter(d => d >= todayISO() && !state.planEntries[d]);
  if (!emptyDays.length) return toast('Your plan is already full!');
  const plannedIds = new Set(Object.values(state.planEntries).map(e => e.recipe_id));
  let pool = state.recipes.filter(r => r.in_box !== false && !plannedIds.has(r.id));
  pool = [...pool, ...pool.filter(r => state.favorites.has(r.id))];   // favorites weighted double
  if (!pool.length) return toast('Add a few recipes to the box first');
  const picks = [];
  for (const day of emptyDays) {
    if (!pool.length) break;
    const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    pool = pool.filter(r => r.id !== pick.id);   // no repeats even via the favorites copy
    picks.push({ day, recipe: pick });
  }
  for (const p of picks) {
    await supabase.from('meal_plan').insert({ recipe_id: p.recipe.id, planned_date: p.day });
  }
  await loadPlan();
  toast(`Planned ${picks.length} dinner${picks.length > 1 ? 's' : ''}`);
  setTimeout(async () => {
    if (!confirm(`Add the ingredients for ${picks.length === 1 ? 'it' : `these ${picks.length} meals`} to the grocery list?`)) return;
    let count = 0;
    for (const p of picks) {
      for (const ing of (p.recipe.ingredients || [])) {
        const disp = ingredientDisplay(ing, 1);
        await addGroceryItem(disp.text, disp.amt, p.recipe.id);
        count++;
      }
    }
    toast(`${count} ingredients added (duplicates merged)`);
  }, 600);
});

qs('#plan-earlier').addEventListener('click', async () => {
  plan.startOffset -= 3;
  await loadPlan();
  qs('#plan-earlier-hide').hidden = false;
  const todayCard = qs('#day-strip .today-card');
  if (todayCard) window.scrollTo({ top: todayCard.offsetTop - 90 });
});
qs('#plan-earlier-hide').addEventListener('click', async () => {
  plan.startOffset = 0;
  await loadPlan();
  qs('#plan-earlier-hide').hidden = true;
  window.scrollTo(0, 0);
});

async function moveEntryToDay(entry, targetDay) {
  const existing = state.planEntries[targetDay];
  if (existing && existing.id !== entry.id) {
    await supabase.from('meal_plan').update({ planned_date: entry.planned_date }).eq('id', existing.id);
  }
  await supabase.from('meal_plan').update({ planned_date: targetDay }).eq('id', entry.id);
  toast(`Moved to ${formatDayLabel(targetDay)}`);
  loadPlan();
}

// Shared picker: assigns a recipe to a day, or moves an existing plan entry.
function openPlanPickerFor(recipe, { tryout = false, moveEntry = null } = {}) {
  const box = qs('#plan-sheet-days');
  box.innerHTML = '';
  const days = [];
  for (let o = 0; o <= Math.max(plan.endOffset, 6); o++) days.push(todayISO(o));
  days.forEach(day => {
    const occupied = state.planEntries[day];
    const row = el('button', 'day-slot', `<div><div style="font-weight:700;">${formatDayLabel(day)}</div><div style="font-size:0.75rem;color:var(--color-ink-faint);">${formatDateSub(day)}${occupied ? ' · ' + occupied.recipes.title : ''}</div></div>`);
    row.style.width = '100%';
    row.style.marginBottom = '10px';
    row.addEventListener('click', async () => {
      closeSheet('plan-sheet', 'plan-sheet-backdrop');
      if (moveEntry) return moveEntryToDay(moveEntry, day);
      await supabase.from('meal_plan').delete().eq('planned_date', day);
      await supabase.from('meal_plan').insert({ recipe_id: recipe.id, planned_date: day });
      toast(tryout ? `On the plan for ${formatDayLabel(day)} — save it to the box if it's a keeper` : `Added to ${formatDayLabel(day)}`);
      if (!qs('#view-plan').hidden) loadPlan();
    });
    box.appendChild(row);
  });
  openSheet('plan-sheet', 'plan-sheet-backdrop');
}

qs('#btn-plan').addEventListener('click', () => openPlanPickerFor(state.currentRecipe));
qs('#plan-sheet-backdrop').addEventListener('click', () => closeSheet('plan-sheet', 'plan-sheet-backdrop'));

function drawPlan() {
  const strip = qs('#day-strip');
  strip.innerHTML = '';
  const today = todayISO();
  visiblePlanDays().forEach(day => {
    const card = el('div', 'day-card' + (day < today ? ' past' : '') + (day === today ? ' today-card' : ''));
    card.innerHTML = `<div class="day-label">${formatDayLabel(day)}</div><div class="date-label">${formatDateSub(day)}</div>`;
    const entry = state.planEntries[day];
    const slot = el('div', 'day-slot' + (entry ? ' filled' : ''));
    if (entry) {
      const tryout = entry.recipes.in_box === false;
      slot.innerHTML = `<div style="flex:1;"><div style="font-weight:700;">${entry.recipes.title}${tryout ? ' <span style="font-size:0.62rem;color:var(--color-gold);font-weight:700;">TRYING IT</span>' : ''}</div><div style="font-size:0.72rem;color:var(--color-ink-faint);">Tap to open · hold to move</div></div><button class="slot-remove" title="Remove">✕</button>`;
      slot.querySelector('div').addEventListener('click', () => openDetail(entry.recipes.id));
      slot.querySelector('.slot-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await supabase.from('meal_plan').delete().eq('id', entry.id);
        // pull its unbought ingredients off the grocery list (bought ones stay)
        const { data: removed } = await supabase.from('grocery_items').delete()
          .eq('recipe_id', entry.recipe_id).eq('checked', false).select('id');
        // a tryout that's no longer planned anywhere has no home — clean it up
        if (entry.recipes.in_box === false) {
          const { data: still } = await supabase.from('meal_plan').select('id').eq('recipe_id', entry.recipe_id);
          if (!still?.length) await deleteRecipeEverywhere(entry.recipes);
        }
        if (removed?.length) toast(`Removed — and took ${removed.length} items off the grocery list`);
        loadPlan();
      });
      addLongPress(slot, () => openPlanPickerFor(null, { moveEntry: entry }));
    } else {
      slot.innerHTML = `<span class="plus">+ Choose a recipe</span>`;
      slot.addEventListener('click', () => { setTab('box'); toast('Pick a recipe, then "Add to plan"'); });
    }
    card.appendChild(slot);
    strip.appendChild(card);
  });
  const addDay = el('button', 'add-row-btn', '+ Plan another day');
  addDay.addEventListener('click', () => { plan.endOffset++; loadPlan(); });
  strip.appendChild(addDay);
}

boot();
