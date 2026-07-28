import AppLayout from "@/components/AppLayout";
import { ExtractPanel } from "@/components/extract/ExtractPanel";
import { useSeo } from "@/hooks/useSeo";

export default function ExtractPage() {
  useSeo({
    title: "Extract & Compare — Easy Editor",
    description: "Translation matrix and reference comparison tool.",
    path: "/extract",
    noindex: true,
  });

  return (
    <AppLayout>
      <ExtractPanel />
    </AppLayout>
  );
}
