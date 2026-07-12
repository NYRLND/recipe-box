import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
if (SUPABASE_URL.startsWith('https://')) {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="padding:60px 30px;text-align:center;font-family:sans-serif;color:#2B2A25;"><h2>Almost there</h2><p>The Supabase project URL still needs to be added to <code>js/config.js</code>.</p></div>';
  });
}

export const supabase = client;
