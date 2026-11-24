import "server-only";
import { cache } from "react";
import { env } from "../env";
import { MemoryStore, resetMemoryDatabase } from "./memory";
import { SupabaseStore } from "./supabase";
import type { DataStore } from "./types";

export type { DataStore, TaskFilters } from "./types";
export { DEMO_ORG_ID, DEMO_USERS, seedMemory } from "./types";

const memory = new MemoryStore();

/**
 * Returns the active repository for this request.
 *
 * `cache()` matters even though the object is trivial: a Supabase store builds
 * a client on every call, and every page asked for it several times (session,
 * layout, three queries). One instance per request means the auth cookie is
 * read once instead of four times.
 */
export const getStore = cache((): DataStore => (env.demoMode ? memory : new SupabaseStore()));

export const memoryStore = memory;
export { resetMemoryDatabase };
