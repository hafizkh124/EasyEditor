import { createContext, useContext } from "react";
import type { useProjectFolder } from "./useProjectFolder";

export type ProjectFolderApi = ReturnType<typeof useProjectFolder>;

export const ProjectFolderContext = createContext<ProjectFolderApi | null>(null);

export function useProjectFolderContext(): ProjectFolderApi {
  const ctx = useContext(ProjectFolderContext);
  if (!ctx) throw new Error("useProjectFolderContext must be used within a ProjectFolderProvider");
  return ctx;
}

/** Null outside a provider — for components that also render in isolation. */
export function useOptionalProjectFolder(): ProjectFolderApi | null {
  return useContext(ProjectFolderContext);
}
