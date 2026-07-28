import { supabase } from "@/integrations/supabase/client";
import type { TaskRun, TaskRunStatus, TaskRunSource } from "./types";
import type { ChunkProgress } from "@/lib/tasks/types";

export const taskRunService = {
  async createTaskRun(params: {
    projectId?: string;
    documentId?: string;
    taskSlug: string;
    input?: Record<string, unknown>;
    model?: string;
  }): Promise<TaskRun | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await (supabase.from("task_runs" as any) as any)
      .insert({
        user_id: user.id,
        project_id: params.projectId || null,
        document_id: params.documentId || null,
        task_slug: params.taskSlug,
        status: "running",
        input: params.input || {},
        output: {},
        sources: [],
        // Left null unless the caller actually knows. The Trust tab reports the
        // model as fact, so the client must not guess one on the server's behalf.
        model: params.model ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("[taskRunService] createTaskRun error:", error);
      return null;
    }
    return data as TaskRun;
  },

  async updateTaskRun(
    runId: string,
    params: {
      status?: TaskRunStatus;
      output?: Record<string, unknown>;
      /** Matches the JSONB array column; passing an object would corrupt it. */
      sources?: TaskRunSource[];
      confidence?: number;
      model?: string;
      tokensSpent?: number;
      error?: string;
      progress?: ChunkProgress;
    },
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {};
    if (params.status) payload.status = params.status;
    if (params.output) payload.output = params.output;
    if (params.sources) payload.sources = params.sources;
    if (params.model !== undefined) payload.model = params.model;
    if (params.confidence !== undefined) payload.confidence = params.confidence;
    if (params.tokensSpent !== undefined) payload.tokens_spent = params.tokensSpent;
    if (params.error !== undefined) payload.error = params.error;
    if (params.progress) payload.progress = params.progress;

    const { error } = await (supabase.from("task_runs" as any) as any)
      .update(payload)
      .eq("id", runId);

    if (error) {
      console.error("[taskRunService] updateTaskRun error:", error);
      return false;
    }
    return true;
  },

  async listTaskRuns(documentId: string): Promise<TaskRun[]> {
    const { data, error } = await (supabase.from("task_runs" as any) as any)
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[taskRunService] listTaskRuns error:", error);
      return [];
    }
    return (data as TaskRun[]) || [];
  },
};
