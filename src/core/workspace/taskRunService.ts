/**
 * Task-run service — facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/taskRuns.ts
 */
import { backendFacade } from "@/core/backend";
import type { TaskRunBackend } from "@/core/backend";

export const taskRunService: TaskRunBackend = backendFacade("taskRuns");
