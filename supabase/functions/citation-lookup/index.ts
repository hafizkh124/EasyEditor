import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { type } = body;

    if (type === "quran") {
      // Exact Quran lookup: { type: "quran", surah: 2, verse: 255 }
      const { surah, verse } = body;
      if (!surah) {
        return new Response(JSON.stringify({ error: "surah is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let query = supabase
        .from("scholarly_documents")
        .select("id, title, content, content_ar, citation_ref, language")
        .eq("source_type", "quran")
        .eq("citation_ref->>surah_number", String(surah));

      if (verse) {
        query = query.eq("citation_ref->>verse", String(verse));
      }

      const { data, error } = await query.order("citation_ref->>verse").limit(300);
      if (error) throw error;

      return new Response(JSON.stringify({ results: data ?? [], count: data?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "hadith") {
      // Exact Hadith lookup: { type: "hadith", collection: "bukhari", hadith_number: "7" }
      const { collection, hadith_number, book } = body;
      if (!collection && !book) {
        return new Response(JSON.stringify({ error: "collection or book is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Alias mapping: short names → canonical collection names in DB
      const COLLECTION_ALIASES: Record<string, string> = {
        bukhari: "Sahih al-Bukhari",
        muslim: "Sahih Muslim",
        tirmidhi: "Jami' al-Tirmidhi",
        "abu dawud": "Sunan Abi Dawud",
        "abu_dawud": "Sunan Abi Dawud",
        nasai: "Sunan al-Nasa'i",
        "ibn majah": "Sunan Ibn Majah",
        "ibn_majah": "Sunan Ibn Majah",
        malik: "Muwatta Malik",
        muwatta: "Muwatta Malik",
        nawawi: "The Forty Hadith of Imam Nawawi",
        "nawawi 40": "The Forty Hadith of Imam Nawawi",
        riyad: "Riyad as-Salihin",
        "riyad as-salihin": "Riyad as-Salihin",
        ahmad: "Musnad Ahmad ibn Hanbal",
        "adab al-mufrad": "Al-Adab Al-Mufrad",
        "bulugh al-maram": "Bulugh al-Maram",
        "qudsi": "The Forty Hadith Qudsi",
        "shamail": "Shama'il Muhammadiyah",
        "mishkat": "Mishkat al-Masabih",
        "shah waliullah": "The Forty Hadith of Shah Waliullah",
      };

      const resolvedCollection = collection
        ? COLLECTION_ALIASES[collection.toLowerCase()] ?? collection
        : undefined;

      let query = supabase
        .from("scholarly_documents")
        .select("id, title, content, content_ar, citation_ref, language")
        .eq("source_type", "hadith");

      if (resolvedCollection) {
        query = query.eq("citation_ref->>collection", resolvedCollection);
      }
      if (book) {
        query = query.eq("citation_ref->>book", book);
      }
      if (hadith_number) {
        query = query.eq("citation_ref->>hadith_number", String(hadith_number));
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;

      return new Response(JSON.stringify({ results: data ?? [], count: data?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "search") {
      // Keyword search: { type: "search", q: "الإيمان", source_type: "quran"|"hadith", limit: 10 }
      const { q, source_type, limit: maxResults } = body;
      if (!q) {
        return new Response(JSON.stringify({ error: "q (query) is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const lim = Math.min(maxResults ?? 20, 50);

      // Build tsquery — split words and join with &
      const words = q.trim().split(/\s+/).filter(Boolean);
      const tsquery = words.map((w: string) => `'${w.replace(/'/g, "''")}'`).join(" & ");

      // Use RPC-style raw query via postgrest text search
      let query = supabase
        .from("scholarly_documents")
        .select("id, title, content, content_ar, citation_ref, language, domain")
        .or(`content_ar.fts(simple).${q},content.fts(simple).${q}`)
        .limit(lim);

      if (source_type) {
        query = query.eq("source_type", source_type);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ results: data ?? [], count: data?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid type. Use: quran, hadith, or search" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("citation-lookup error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
