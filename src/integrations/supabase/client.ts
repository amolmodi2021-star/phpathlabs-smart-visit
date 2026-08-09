// Supabase client — attaches staff JWT from custom app auth when present.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const ACCESS_TOKEN_KEY = "ph_pathlabs_access_token";

export function getStoredAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAccessToken(token: string | null) {
  try {
    if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // ignore storage failures
  }
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers || {});
      const token = getStoredAccessToken();
      // Staff JWT is signed by user-auth with JWT_SECRET. PostgREST only accepts
      // JWTs signed with the project's JWT secret — a mismatch yields
      // "No suitable key or wrong key type". Keep Authorization as the anon key
      // for REST/Realtime; send staff token separately for edge functions.
      if (token) {
        headers.set("x-ph-access-token", token);
      }
      return fetch(input, { ...init, headers });
    },
  },
});
