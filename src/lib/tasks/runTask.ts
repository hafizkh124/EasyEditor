import { getTaskBySlug } from "./registry";
import { calculateTaskCost, checkSolvency } from "./cost";
import { taskRunService } from "@/core/workspace/taskRunService";
import {
  callRefineTextDetailed,
  isRefineTextAction,
  MAX_REFINE_CHARS,
  type RefineTextAction,
} from "@/lib/editor/aiActions";
import type { TaskRunResult } from "./types";

export interface RunSingleBatchTaskArgs {
  taskSlug: string;
  text: string;
  accessToken?: string;
  projectId?: string;
  documentId?: string;
  /**
   * The user's real token balance. Leave undefined only when it is genuinely
   * unknown — there is deliberately no numeric default, because a made-up
   * balance would let the pre-flight check pass for a user who cannot pay
   * (SPEC-M3 FR-2.6).
   */
  availableTokens?: number;
}

export async function runSingleBatchTask({
  taskSlug,
  text,
  accessToken = "",
  projectId,
  documentId,
  availableTokens,
}: RunSingleBatchTaskArgs): Promise<TaskRunResult> {
  const task = getTaskBySlug(taskSlug);
  if (!task) {
    throw new Error(`معلومات: ٹاسک '${taskSlug}' دستیاب نہیں ہے۔`);
  }

  const sourceText = text.trim();
  if (!sourceText) {
    return { text: "" };
  }

  if (sourceText.length > MAX_REFINE_CHARS) {
    throw new Error("دستاویز بڑی ہے — متن منتخب کریں، یا حصہ بہ حصہ (chunked) رن چلائیں۔");
  }

  // 1. Client Engine (Instant execution, 0 cost, no DB overhead)
  if (task.engine === "client" && task.clientFn) {
    const result = task.clientFn(sourceText);
    return { text: result, tokensSpent: 0 };
  }

  // Cost calculation & pre-flight solvency check (FR-2.6). This runs before the
  // request is built, so an unaffordable action never reaches the network.
  const requiredTokens = calculateTaskCost(task, sourceText.length);
  if (typeof availableTokens === "number") {
    const solvency = checkSolvency(requiredTokens, availableTokens);
    if (!solvency.isSolvent) {
      throw new Error(
        `ٹوکن ناکافی ہیں: اس کام کے لیے ${solvency.requiredTokens} ٹوکن درکار ہیں، ` +
          `آپ کے پاس ${solvency.availableTokens} ہیں (${solvency.deficit} کی کمی)۔`,
      );
    }
  }

  // 2. Refine-Text Server Engine. A custom task carries a `taskId` instead of an
  // action name — the server resolves its prompt under the caller's user_id.
  if (!task.taskId && (!task.actionName || !isRefineTextAction(task.actionName))) {
    throw new Error(`ٹاسک اکشن '${task.actionName}' مفقود یا باطل ہے۔`);
  }
  const action = (task.actionName ?? "formalize") as RefineTextAction;

  const run = await taskRunService.createTaskRun({
    projectId,
    documentId,
    taskSlug: task.slug,
    input: { length: sourceText.length, sample: sourceText.slice(0, 100) },
  });

  try {
    const result = await callRefineTextDetailed(sourceText, action, accessToken, task.taskId);
    // The server is the authority on what was actually spent and which model
    // ran; fall back to the estimate only when an older deployment omits them.
    const tokensSpent = result.tokensUsed ?? requiredTokens;

    if (run?.id) {
      await taskRunService.updateTaskRun(run.id, {
        status: "completed",
        output: { text: result.text },
        sources: result.sources,
        // Only citation-producing tasks carry a confidence. Writing one for a
        // spell-check would put an invented number in front of a scholar.
        confidence: task.producesSources ? result.confidence ?? undefined : undefined,
        model: result.model ?? undefined,
        tokensSpent,
      });
    }

    return {
      runId: run?.id,
      text: task.outputFormat === "html" ? undefined : result.text,
      html: task.outputFormat === "html" ? result.text : undefined,
      sources: result.sources,
      confidence: task.producesSources ? result.confidence : null,
      model: result.model ?? undefined,
      tokensSpent,
    };
  } catch (err) {
    if (run?.id) {
      await taskRunService.updateTaskRun(run.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "Execution error",
      });
    }
    throw err;
  }
}
