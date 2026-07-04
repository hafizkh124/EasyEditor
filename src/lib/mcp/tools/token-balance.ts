import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "token_balance",
  title: "Get token balance",
  description:
    "Return the signed-in user's Easy Editor token wallet: monthly balance, monthly limit, and top-up balance.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("token_wallets")
      .select("monthly_balance, monthly_limit, topup_balance, updated_at")
      .eq("user_id", ctx.getUserId())
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const wallet = data ?? {
      monthly_balance: 0,
      monthly_limit: 0,
      topup_balance: 0,
      updated_at: null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(wallet, null, 2) }],
      structuredContent: { wallet },
    };
  },
});

void z;
