// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,      // ✅ NO guarda sesión => refresh vuelve a login
    autoRefreshToken: false,    // ✅ no intentes refrescar tokens
    detectSessionInUrl: false,
  },
});