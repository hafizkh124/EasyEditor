import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { embedBatch } from "../_shared/embed.ts";
import { fetchAndExtractStorageFile } from "../_shared/fileText.ts";
// SPEC-M5 FR-1.3: one chunker, shared with the Electron main process.
import { chunkDocumentText } from "../_shared/mirror/text/documentChunks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client with JWT auth header to resolve user ID securely
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id; // STRICT SECURITY: Never trust user_id from body (NFR-5)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { item_id, offset = 0, batch_size = 100 } = body;

    if (!item_id) {
      return new Response(JSON.stringify({ error: "Missing item_id parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify item belongs to this authenticated user
    const { data: libraryItem, error: itemError } = await serviceClient
      .from("library_items")
      .select("*")
      .eq("id", item_id)
      .eq("user_id", userId)
      .single();

    if (itemError || !libraryItem) {
      return new Response(JSON.stringify({ error: "Library item not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const storagePath = libraryItem.storage_path;
    if (!storagePath) {
      return new Response(JSON.stringify({ error: "Library item missing storage_path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Extract text from library-files storage bucket.
    //
    // Cached on the item after the first call: a 300-page PDF takes several
    // batches, and re-downloading plus re-parsing it for every one of them
    // multiplies the work by the batch count and risks the 60s function limit
    // on exactly the large books this path exists for.
    const cachedText = libraryItem.meta?.ingest?.extracted_text;
    const fullText = typeof cachedText === "string" && cachedText.length > 0
      ? cachedText
      : await fetchAndExtractStorageFile(serviceClient, "library-files", storagePath);
    if (fullText.startsWith("[")) {
      // Extraction failed or unreadable
      await serviceClient.from("library_items").update({
        meta: {
          ...libraryItem.meta,
          ingest: { status: "failed", error: fullText, progress: 0 },
        },
      }).eq("id", item_id);

      return new Response(JSON.stringify({ error: fullText, done: true, failed: true }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Chunk text
    const allChunks = chunkDocumentText(fullText);
    const totalChunks = allChunks.length;

    if (totalChunks === 0) {
      await serviceClient.from("library_items").update({
        meta: {
          ...libraryItem.meta,
          ingest: { status: "ready", progress: 100, total_chunks: 0 },
        },
      }).eq("id", item_id);

      return new Response(JSON.stringify({ item_id, inserted: 0, next_offset: 0, done: true, total_chunks: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Slice batch to embed
    const currentOffset = Math.min(offset, totalChunks);
    const batch = allChunks.slice(currentOffset, currentOffset + batch_size);

    if (batch.length === 0) {
      await serviceClient.from("library_items").update({
        meta: {
          ...libraryItem.meta,
          ingest: { status: "ready", progress: 100, total_chunks: totalChunks },
        },
      }).eq("id", item_id);

      return new Response(JSON.stringify({ item_id, inserted: 0, next_offset: totalChunks, done: true, total_chunks: totalChunks }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Generate embeddings for batch
    const textsToEmbed = batch.map((c) => c.content);
    const embeddings = await embedBatch(textsToEmbed);

    // 5. Insert rows into library_chunks table
    const rowsToInsert = batch.map((c, i) => ({
      user_id: userId,
      library_item_id: item_id,
      chunk_index: c.index,
      content: c.content,
      language: "ur",
      char_start: c.charStart,
      char_end: c.charEnd,
      embedding: embeddings[i],
      meta: {},
    }));

    const { error: insertError } = await serviceClient
      .from("library_chunks")
      .upsert(rowsToInsert, { onConflict: "library_item_id,chunk_index" });

    if (insertError) {
      console.error("[library-ingest] upsert error:", insertError);
      throw insertError;
    }

    const nextOffset = currentOffset + batch.length;
    const isDone = nextOffset >= totalChunks;
    const progressPercent = Math.round((nextOffset / totalChunks) * 100);

    // 6. Update item meta ingest status. The extracted text is carried while
    //    the run is unfinished and dropped once it is, so a finished item does
    //    not keep a second full copy of the book in its metadata.
    await serviceClient.from("library_items").update({
      meta: {
        ...libraryItem.meta,
        ingest: {
          status: isDone ? "ready" : "embedding",
          progress: progressPercent,
          total_chunks: totalChunks,
          next_offset: nextOffset,
          ...(isDone ? {} : { extracted_text: fullText }),
        },
      },
    }).eq("id", item_id);

    return new Response(
      JSON.stringify({
        item_id,
        inserted: batch.length,
        next_offset: nextOffset,
        done: isDone,
        total_chunks: totalChunks,
        progress: progressPercent,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[library-ingest] exception:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
