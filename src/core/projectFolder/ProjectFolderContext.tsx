import React from "react";
import { useProjectFolder } from "./useProjectFolder";
import { ProjectFolderContext } from "./context";

/**
 * SPEC-M8 P7 — one project-folder session per workspace, so there is a single
 * `fs.watch` and a single reopen-last-folder effect. Both the Library's import
 * list and the export dialogs read from here.
 */
export const ProjectFolderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const api = useProjectFolder();
  return <ProjectFolderContext.Provider value={api}>{children}</ProjectFolderContext.Provider>;
};
