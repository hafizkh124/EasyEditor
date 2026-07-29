/**
 * The Supabase-backed WorkspaceBackend. Assembly only — every implementation
 * lives in ./cloud/*, one file per concern.
 */
import type { WorkspaceBackend } from "./types";
import { cloudDocuments } from "./cloud/documents";
import { cloudLibrary } from "./cloud/library";
import { cloudAnnotations } from "./cloud/annotations";
import { cloudTaskRuns } from "./cloud/taskRuns";
import { cloudGraph } from "./cloud/graph";
import { cloudIdentity, cloudRecipes, cloudCustomTasks } from "./cloud/misc";

export const cloudBackend: WorkspaceBackend = {
  kind: "cloud",
  identity: cloudIdentity,
  documents: cloudDocuments,
  library: cloudLibrary,
  annotations: cloudAnnotations,
  taskRuns: cloudTaskRuns,
  graph: cloudGraph,
  recipes: cloudRecipes,
  customTasks: cloudCustomTasks,
};
