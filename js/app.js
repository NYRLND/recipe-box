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
  planDays: [todayISO(0), todayISO(1), todayISO(2)],
  planEntries: {},      // date -> recipe row
  cookRecipe: null,
  cookIndex: 0,
  timerInterval: null,
  shareTargetRecipe: null,
};

/* ================= View routing ================= */

function showView(id) {
  qsa('.view').forEach(v => v.hidden = true);
  qs('#' + id).hidden = false;
}

function setTab(tab) {
  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'box') { showView('view-box'); renderBox(); }
  if (tab === 'discover') { showView('view-discover'); initDiscover(); }
  if (tab === 'plan') { showView('view-plan'); loadPlan(); }
  if (tab === 'grocery') { showView('view-grocery'); loadGrocery(); }
  qs('#fab-add').hidden = tab !== 'box';
  const names = { box: 'Recipes', discover: 'Discover', plan: 'Meal Plan', grocery: 'Grocery List' };
  qs('#topbar-eyebrow').textContent = names[tab] || '';
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
  const tagSet = new Set();
  state.recipes.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
  state.tags = Array.from(tagSet).slice(0, 10);
}

async function renderBox() {
  await Promise.all([loadRecipes(), loadFavorites()]);
  renderTagChips();
  drawGrid();
}

function renderTagChips() {
  const row = qs('#tag-chips');
  row.innerHTML = '';
  const favChip = el('button', 'chip' + (state.activeTag === '__fav' ? ' active' : ''), '♥ Favorites');
  favChip.addEventListener('click', () => { state.activeTag = state.activeTag === '__fav' ? null : '__fav'; renderTagChips(); drawGrid(); });
  row.appendChild(favChip);
  state.tags.forEach(tag => {
    const c = el('button', 'chip' + (state.activeTag === tag ? ' active' : ''), tag);
    c.addEventListener('click', () => { state.activeTag = state.activeTag === tag ? null : tag; renderTagChips(); drawGrid(); });
    row.appendChild(c);
  });
}

function drawGrid() {
  const grid = qs('#recipe-grid');
  grid.innerHTML = '';
  let list = state.recipes;
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

  if (r.parent_recipe_id) card.appendChild(el('div', 'remix-pill', 'Remixed'));

  const body = el('div', 'body');
  body.appendChild(el('h3', null, r.title));
  body.appendChild(el('div', 'source', r.source || 'Your kitchen'));
  card.appendChild(body);

  card.addEventListener('click', () => openDetail(r.id));
  return card;
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
  qs('#detail-actions-preview').hidden = !preview;

  qs('#detail-hero').style.backgroundImage = r.image_url ? `url('${r.image_url}')` : 'none';
  qs('#detail-hero').style.display = r.image_url ? '' : 'none';
  qs('#detail-title').textContent = r.title;
  qs('#detail-source').innerHTML = r.source_url
    ? `From <a href="${r.source_url}" target="_blank" rel="noopener">${r.source || 'the web'}</a>`
    : (r.source ? `From ${r.source}` : `Added by ${state.member.name}`);
  qs('#detail-prep').textContent = r.prep_time || '–';
  qs('#detail-cook').textContent = r.cook_time || '–';
  qs('#detail-times').textContent = `${r.times_cooked || 0}×`;
  qs('#serv-value').textContent = state.currentServings;

  renderDetailIngredients();
  renderDetailSteps();
  renderDetailNotes();
  window.scrollTo(0, 0);
}

qs('#surprise-btn').addEventListener('click', () => {
  if (!state.recipes.length) return toast('Add some recipes first!');
  // favorites count double so the family's loves come up more often
  const pool = [...state.recipes, ...state.recipes.filter(r => state.favorites.has(r.id))];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  toast('Tonight\'s house special…');
  setTimeout(() => openDetail(pick.id), 400);
});

qs('#btn-preview-edit').addEventListener('click', () => openEditor());
qs('#btn-preview-save').addEventListener('click', async () => {
  const d = state.draft;
  if (!d.title) return toast('This one has no title — tap Edit details');
  const { data, error } = await supabase.from('recipes').insert({
    title: d.title, source: d.source, source_url: d.source_url || null, image_url: d.image_url,
    servings: d.servings || 4, prep_time: d.prep_time, cook_time: d.cook_time,
    ingredients: d.ingredients || [], steps: d.steps || [], tags: d.tags || [],
    notes: d.notes || '', created_by: state.member.id, parent_recipe_id: state.parentForRemix,
  }).select().single();
  if (error) return toast('Could not save — try again');
  toast('Saved to your recipe box');
  await renderBox();
  openDetail(data.id);
});

qs('#btn-delete').addEventListener('click', async () => {
  const r = state.currentRecipe;
  if (!confirm(`Remove "${r.title}" from the recipe box? This is for the whole family and can't be undone.`)) return;
  // detach any remixes so the foreign key doesn't block deletion
  await supabase.from('recipes').update({ parent_recipe_id: null }).eq('parent_recipe_id', r.id);
  const { error } = await supabase.from('recipes').delete().eq('id', r.id);
  if (error) return toast('Could not delete — try again');
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
      row.classList.toggle('checked');
    });
    box.appendChild(row);
  });
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

qs('#detail-back').addEventListener('click', () => setTab('box'));
qs('#serv-plus').addEventListener('click', () => { state.currentServings++; qs('#serv-value').textContent = state.currentServings; renderDetailIngredients(); });
qs('#serv-minus').addEventListener('click', () => { if (state.currentServings > 1) state.currentServings--; qs('#serv-value').textContent = state.currentServings; renderDetailIngredients(); });

qs('#add-all-grocery').addEventListener('click', async () => {
  const r = state.currentRecipe;
  const scale = state.currentServings / (r.servings || state.currentServings || 1);
  for (const ing of (r.ingredients || [])) {
    const disp = ingredientDisplay(ing, scale);
    await addGroceryItem(disp.text, disp.amt, r.id);
  }
  toast('Added to grocery list');
});

/* ---- Remix ---- */
qs('#btn-remix').addEventListener('click', () => {
  const r = state.currentRecipe;
  state.draft = JSON.parse(JSON.stringify(r));
  state.draft.title = r.title + ` (${state.member.name}'s version)`;
  state.parentForRemix = r.id;
  state.draftMode = 'remix';
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
  if (secs) {
    chip.hidden = false;
    chip.textContent = `⏱ Start ${Math.round(secs/60) || 1} min timer`;
    chip.onclick = () => startTimer(secs, chip);
  } else {
    chip.hidden = true;
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

/* ---- Add to plan ---- */
qs('#btn-plan').addEventListener('click', () => {
  openSheet('plan-sheet', 'plan-sheet-backdrop');
  const box = qs('#plan-sheet-days');
  box.innerHTML = '';
  state.planDays.forEach(day => {
    const row = el('button', 'day-slot', `<div><div style="font-weight:700;">${formatDayLabel(day)}</div><div style="font-size:0.75rem;color:var(--color-ink-faint);">${formatDateSub(day)}</div></div>`);
    row.style.width = '100%';
    row.style.marginBottom = '10px';
    row.addEventListener('click', async () => {
      await supabase.from('meal_plan').delete().eq('planned_date', day);
      await supabase.from('meal_plan').insert({ recipe_id: state.currentRecipe.id, planned_date: day });
      toast(`Added to ${formatDayLabel(day)}`);
      closeSheet('plan-sheet', 'plan-sheet-backdrop');
    });
    box.appendChild(row);
  });
});
qs('#plan-sheet-backdrop').addEventListener('click', () => closeSheet('plan-sheet', 'plan-sheet-backdrop'));

/* ================= Import ================= */

qs('#fab-add').addEventListener('click', () => { showView('view-import'); qs('#import-status').hidden = true; qs('#import-url').value = ''; });
qs('#import-back').addEventListener('click', () => setTab('box'));
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

async function importFromUrl(url, statusEl) {
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
    notes: '',
  };
  state.draftMode = 'import';
  state.parentForRemix = null;
  if (statusEl) statusEl.hidden = true;
  openDraftPreview();
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

const DISCOVER_CATS = ['Chicken','Pasta','30-Minute','Seafood','Beef','Vegetarian','Soup','Salad','Slow Cooker','Dessert','Breakfast'];
const disc = { mode: 'feed', query: '', page: 1, busy: false, done: false, started: false };

function discoverCard(r) {
  const card = el('div', 'recipe-card');
  const thumb = el('div', 'thumb');
  if (r.image) thumb.style.backgroundImage = `url('${r.image}')`;
  else thumb.textContent = r.title[0] || '?';
  card.appendChild(thumb);
  const body = el('div', 'body');
  body.appendChild(el('h3', null, r.title));
  body.appendChild(el('div', 'source', r.source));
  card.appendChild(body);
  card.addEventListener('click', async () => {
    const status = qs('#discover-status');
    try {
      await importFromUrl(r.url, status);
      state.draft.source = r.source || state.draft.source;
    } catch (err) {
      status.hidden = false;
      status.textContent = /No recipe data/.test(err.message)
        ? `That one's an article, not a single recipe — try another card.`
        : `Couldn't import that one (${err.message}) — try another.`;
    }
  });
  return card;
}

function renderDiscoverChips() {
  const row = qs('#discover-chips');
  if (row.children.length) return;
  DISCOVER_CATS.forEach(cat => {
    const c = el('button', 'chip', cat);
    c.addEventListener('click', () => {
      qsa('#discover-chips .chip').forEach(x => x.classList.toggle('active', x === c && !c.classList.contains('active')));
      qs('#discover-input').value = c.classList.contains('active') ? cat : '';
      if (c.classList.contains('active')) runDiscoverSearch(); else resetToFeed();
    });
    row.appendChild(c);
  });
}

async function fetchDiscoverPage() {
  if (disc.busy || disc.done) return;
  disc.busy = true;
  const more = qs('#discover-more-status');
  if (disc.page > 1) more.hidden = false;
  try {
    const payload = disc.mode === 'search' ? { search: disc.query, page: disc.page } : { feed: true, page: disc.page };
    const data = await callImportFn(payload);
    const results = data.results || [];
    const box = disc.mode === 'search' ? qs('#discover-results') : qs('#discover-feed');
    results.forEach(r => box.appendChild(discoverCard(r)));
    if (disc.page === 1) {
      qs('#discover-results-label').hidden = !(disc.mode === 'search' && results.length);
      qs('#discover-feed-label').hidden = !(disc.mode === 'feed' && results.length);
      if (disc.mode === 'search' && !results.length) {
        const s = qs('#discover-status');
        s.hidden = false;
        s.textContent = `No results for "${disc.query}" — try a simpler term, like one main ingredient.`;
      }
    }
    if (!results.length) disc.done = true;
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

function resetDiscover(mode, query) {
  disc.mode = mode; disc.query = query || ''; disc.page = 1; disc.done = false; disc.busy = false;
  qs('#discover-results').innerHTML = '';
  qs('#discover-results-label').hidden = true;
  qs('#discover-status').hidden = true;
  if (mode === 'search') {
    qs('#discover-feed').innerHTML = '';
    qs('#discover-feed-label').hidden = true;
  }
}

function resetToFeed() {
  resetDiscover('feed');
  qs('#discover-feed').innerHTML = '';
  const s = qs('#discover-status');
  s.hidden = false;
  s.innerHTML = `<div class="spinner"></div> Loading fresh recipes…`;
  fetchDiscoverPage().then(() => { if (!disc.done || qs('#discover-feed').children.length) s.hidden = true; });
}

async function initDiscover() {
  renderDiscoverChips();
  if (disc.started) return;
  disc.started = true;
  resetToFeed();
  // infinite scroll
  const sentinel = qs('#discover-sentinel');
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !qs('#view-discover').hidden) fetchDiscoverPage();
  }, { rootMargin: '400px' }).observe(sentinel);
}

async function runDiscoverSearch() {
  const q = qs('#discover-input').value.trim();
  if (!q) return;
  resetDiscover('search', q);
  const status = qs('#discover-status');
  status.hidden = false;
  status.innerHTML = `<div class="spinner"></div> Searching your favorite sites…`;
  await fetchDiscoverPage();
  if (qs('#discover-results').children.length) status.hidden = true;
}

qs('#discover-go').addEventListener('click', runDiscoverSearch);
qs('#discover-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); runDiscoverSearch(); } });
qs('#discover-paste-link').addEventListener('click', () => { showView('view-import'); qs('#import-status').hidden = true; });

/* ================= Editor (import preview / manual / remix) ================= */

function openEditor() {
  const d = state.draft;
  qs('#editor-heading').textContent = state.draftMode === 'remix' ? 'Remix this recipe' : state.draftMode === 'import' ? 'Review recipe' : 'Add a recipe';
  qs('#ed-title').value = d.title || '';
  qs('#ed-source').value = d.source || '';
  qs('#ed-image').value = d.image_url || '';
  qs('#ed-servings').value = d.servings || 4;
  qs('#ed-prep').value = d.prep_time || '';
  qs('#ed-cook').value = d.cook_time || '';
  qs('#ed-note-label').textContent = state.draftMode === 'remix' ? "What did you change?" : 'Note (optional)';
  qs('#ed-note').value = d.notes || '';

  const ingBox = qs('#ed-ingredients'); ingBox.innerHTML = '';
  (d.ingredients || []).forEach(ing => addEditorRow(ingBox, ing.raw || [ing.amount, ing.unit, ing.item].filter(Boolean).join(' ')));
  if (!d.ingredients?.length) addEditorRow(ingBox, '');

  const stepBox = qs('#ed-steps'); stepBox.innerHTML = '';
  (d.steps || []).forEach(s => addEditorRow(stepBox, s, true));
  if (!d.steps?.length) addEditorRow(stepBox, '', true);

  showView('view-editor');
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
  else setTab('box');
});

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
    notes: qs('#ed-note').value.trim(),
    created_by: state.member.id,
    parent_recipe_id: state.parentForRemix,
  };

  const { data, error } = await supabase.from('recipes').insert(payload).select().single();
  if (error) return toast('Could not save — try again');
  toast('Saved to your recipe box');
  await renderBox();
  openDetail(data.id);
});

/* ================= Grocery List ================= */

async function loadGrocery() {
  const { data } = await supabase.from('grocery_items').select('*').order('created_at', { ascending: true });
  state.groceryItems = data || [];
  drawGrocery();
}

function drawGrocery() {
  const content = qs('#grocery-content');
  content.innerHTML = '';
  qs('#grocery-empty').hidden = state.groceryItems.length > 0;
  if (state.groceryItems.length) {
    const done = state.groceryItems.filter(i => i.checked).length;
    const prog = el('div', 'grocery-progress',
      `<div class="count">${done} of ${state.groceryItems.length} in the cart</div><div class="bar"><div style="width:${Math.round(done / state.groceryItems.length * 100)}%;"></div></div>`);
    content.appendChild(prog);
  }
  const byCat = {};
  state.groceryItems.forEach(item => {
    const cat = categorize(item.item);
    (byCat[cat] = byCat[cat] || []).push(item);
  });
  const order = ['Produce','Meat & Seafood','Dairy & Eggs','Bakery','Pantry','Frozen','Other'];
  order.filter(c => byCat[c]?.length).forEach(cat => {
    const section = el('div', 'grocery-section');
    section.appendChild(el('div', 'cat-label', cat));
    byCat[cat].sort((a,b) => a.checked - b.checked).forEach(item => section.appendChild(groceryRow(item)));
    content.appendChild(section);
  });
  if (state.groceryItems.some(i => i.checked)) {
    const clearBtn = el('button', 'btn btn-ghost', 'Clear checked items');
    clearBtn.style.marginTop = '18px';
    clearBtn.addEventListener('click', async () => {
      const ids = state.groceryItems.filter(i => i.checked).map(i => i.id);
      await supabase.from('grocery_items').delete().in('id', ids);
      loadGrocery();
    });
    content.appendChild(clearBtn);
  }
}

function groceryRow(item) {
  const row = el('div', 'grocery-row' + (item.checked ? ' checked' : ''));
  row.innerHTML = `<div class="check-circle${item.checked ? ' checked' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
    <div class="txt">${item.item}</div>
    ${item.amount ? `<div class="amt">${item.amount}</div>` : ''}`;
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

async function addGroceryItem(name, amount, recipeId) {
  const { data } = await supabase.from('grocery_items').insert({
    item: name, amount: amount || null, added_by: state.member?.id || null, recipe_id: recipeId || null,
  }).select().single();
  if (data) state.groceryItems.push(data);
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

/* ================= Meal Plan (flexible 3-day) ================= */

async function loadPlan() {
  const { data } = await supabase.from('meal_plan').select('*, recipes(*)').in('planned_date', state.planDays);
  state.planEntries = {};
  (data || []).forEach(row => { state.planEntries[row.planned_date] = row; });
  drawPlan();
}

function drawPlan() {
  const strip = qs('#day-strip');
  strip.innerHTML = '';
  state.planDays.forEach(day => {
    const card = el('div', 'day-card');
    card.innerHTML = `<div class="day-label">${formatDayLabel(day)}</div><div class="date-label">${formatDateSub(day)}</div>`;
    const entry = state.planEntries[day];
    const slot = el('div', 'day-slot' + (entry ? ' filled' : ''));
    if (entry) {
      slot.innerHTML = `<div style="flex:1;"><div style="font-weight:700;">${entry.recipes.title}</div><div style="font-size:0.72rem;color:var(--color-ink-faint);">Tap to open</div></div><button class="slot-remove" title="Remove">✕</button>`;
      slot.querySelector('div').addEventListener('click', () => openDetail(entry.recipes.id));
      slot.querySelector('.slot-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await supabase.from('meal_plan').delete().eq('id', entry.id);
        loadPlan();
      });
    } else {
      slot.innerHTML = `<span class="plus">+ Choose a recipe</span>`;
      slot.addEventListener('click', () => { setTab('box'); toast('Pick a recipe, then "Add to plan"'); });
    }
    card.appendChild(slot);
    strip.appendChild(card);
  });
  const addDay = el('button', 'add-row-btn', '+ Plan another day');
  addDay.addEventListener('click', () => {
    state.planDays.push(todayISO(state.planDays.length));
    loadPlan();
  });
  strip.appendChild(addDay);
}

boot();
