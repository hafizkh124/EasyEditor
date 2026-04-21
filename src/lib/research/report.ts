import type { Source, ChatMessage } from "@/components/research/types";

export function downloadResearchReport(messages: ChatMessage[], sources: Source[]): void {
  const sourceList = sources.length > 0
    ? `## Sources\n${sources.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}`).join("\n")}\n\n`
    : "";
  const body = messages.map((m) =>
    m.role === "user"
      ? `## Question\n${m.content}`
      : `## Answer\n${m.content}`
  ).join("\n\n---\n\n");
  const report = `# Research Report\n_Generated: ${new Date().toLocaleString()}_\n\n${sourceList}${body}`;
  const blob = new Blob([report], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `research-report-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
