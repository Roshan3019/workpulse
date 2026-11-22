import "server-only";
import { env } from "../env";
import { MemoryStore, resetMemoryDatabase } from "./memory";
import { SupabaseStore } from "./supabase";
import type { DataStore } from "./types";

export type { DataStore, TaskFilters } from "./types";
export { DEMO_ORG_ID, DEMO_USERS, seedMemory } from "./types";

const memory = new MemoryStore();

/** Returns the active repository for this request. */
export function getStore(): DataStore {
  return env.demoMode ? memory : new SupabaseStore();
}

export const memoryStore = memory;
export { resetMemoryDatabase };
