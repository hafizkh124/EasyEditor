import { Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { useSeo } from "@/hooks/useSeo";

const Research = () => {
  useSeo({
    title: "Quran & Hadith AI — Grounded Islamic Research",
    description: "Grounded Islamic research assistant with cited answers from Quran, Hadith and classical sources in Urdu, Arabic and English.",
    path: "/research",
    noindex: true,
  });

  if (import.meta.env.VITE_WORKSPACE_SHELL !== "false") {
    return <Navigate to="/workspace?panel=research" replace />;
  }

  return (
    <AppLayout>
      <ResearchPanel />
    </AppLayout>
  );
};

export default Research;
