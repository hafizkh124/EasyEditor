/**
 * Recipe service — facade over the backend adapter (M5.0).
 * Implementation: src/core/backend/cloud/misc.ts
 *
 * The shape and the built-ins live in ./builtinRecipes so the backend can read
 * them without importing this module back.
 */
import { backendFacade } from "@/core/backend";
import type { RecipeBackend } from "@/core/backend";

export type { Recipe, RecipeStep } from "./builtinRecipes";
export { BUILTIN_RECIPES } from "./builtinRecipes";

export const recipeService: RecipeBackend = backendFacade("recipes");
