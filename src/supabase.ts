import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables.')
}

export function createClerkSupabaseClient(
  getToken: () => Promise<string | null>
) {
  return createClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      accessToken: async () => {
        return getToken()
      },
    }
  )
}