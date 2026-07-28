import { useState, useEffect, useCallback } from "react";
import { documentService } from "./documentService";
import type { Project, ProjectKind } from "./types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await documentService.listProjects();
      setProjects(data);
    } catch (err: any) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async (title: string, kind: ProjectKind = "general", meta?: Record<string, unknown>) => {
    try {
      const newProj = await documentService.createProject(title, kind, meta);
      setProjects((prev) => [newProj, ...prev]);
      return newProj;
    } catch (err: any) {
      console.error("[useProjects] Create project error:", err);
      throw err;
    }
  };

  return {
    projects,
    loading,
    error,
    createProject,
    refreshProjects: fetchProjects,
  };
}
