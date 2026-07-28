import AppLayout from "@/components/AppLayout";
import { TranslatePanel } from "@/components/translate/TranslatePanel";
import { useSeo } from "@/hooks/useSeo";

const Translate = () => {
  useSeo({
    title: "Translate — Easy Editor",
    description: "Translate text, PDFs, and images with AI, voice, or manual input.",
    path: "/translate",
    noindex: true,
  });

  return (
    <AppLayout>
      <TranslatePanel />
    </AppLayout>
  );
};

export default Translate;
