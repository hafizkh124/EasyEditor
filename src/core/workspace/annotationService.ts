/**
 * Annotation service — facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/annotations.ts
 */
import { backendFacade } from "@/core/backend";
import type { AnnotationBackend } from "@/core/backend";

export interface AnnotationItem {
  id: string;
  document_id: string;
  user_id: string;
  anchor: {
    quote: string;
    isDetached?: boolean;
  };
  note: string;
  color?: string;
  created_at: string;
}

export const annotationService: AnnotationBackend = backendFacade("annotations");
