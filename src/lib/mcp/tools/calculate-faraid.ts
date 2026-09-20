import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { calculateFaraid } from "../../../../shared/faraid/calculator";
import { HEIR_TYPES, type HeirCounts } from "../../../../shared/faraid/heirs";

const HeirsSchema = z.record(z.string(), z.number().int().nonnegative())
  .describe("Map of surviving heir type to count, e.g. { husband: 1, daughter: 2, mother: 1, fullBrother: 1 }");

export default defineTool({
  name: "calculate_faraid",
  title: "Calculate Islamic Inheritance (Fara'id)",
  description:
    "Pure deterministic Islamic inheritance calculation adhering to the Jumhūr consensus. Calculates Asl al-Mas'alah, fixed shares, residuary (asaba), Awl, and Radd with Quranic and Hadith proofs.",
  inputSchema: {
    heirs: HeirsSchema,
    estateValue: z.number().positive().optional().describe("Optional total cash or property value to distribute"),
    currency: z.string().default("PKR").optional().describe("Currency symbol/code for estate valuation (default PKR)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ heirs, estateValue, currency = "PKR" }, _ctx) => {
    const validHeirs: HeirCounts = {};
    for (const [key, count] of Object.entries(heirs)) {
      if ((HEIR_TYPES as readonly string[]).includes(key) && count > 0) {
        validHeirs[key as keyof HeirCounts] = count;
      }
    }

    if (Object.keys(validHeirs).length === 0) {
      return {
        content: [{ type: "text", text: "No valid surviving heirs provided." }],
        isError: true,
      };
    }

    const result = calculateFaraid({
      heirs: validHeirs,
      estateValue,
      currency,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});
