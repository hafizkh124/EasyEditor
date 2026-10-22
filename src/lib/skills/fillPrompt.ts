import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";

/** A prompt skill's instruction with the scholar's answers in place of its `{{arguments}}`. */
export function fillPromptTemplate(prompt: ScholarlyPromptDef, values: Record<string, string>): string {
  return prompt.arguments.reduce(
    (text, arg) => text.replace(new RegExp(`{{${arg.name}}}`, "g"), (values[arg.name] ?? "").trim()),
    prompt.systemInstructionTemplate,
  );
}

