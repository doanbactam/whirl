import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

export type Memory = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

const listMemoriesRef = makeFunctionReference<"query">("memory:listMemories");
const getMemoriesByIdsRef = makeFunctionReference<"query">(
  "memory:getMemoriesByIds",
);
const getMemorySettingsRef = makeFunctionReference<"query">(
  "memory:getMemorySettings",
);
const setMemoryEnabledRef = makeFunctionReference<"mutation">(
  "memory:setMemoryEnabled",
);
const updateMemoryRef = makeFunctionReference<"mutation">("memory:updateMemory");
const deleteMemoryRef = makeFunctionReference<"mutation">("memory:deleteMemory");
const clearMemoriesRef = makeFunctionReference<"mutation">(
  "memory:clearMemories",
);

/** All of the signed-in user's memories, plus mutators. `enabled` whether to query. */
export function useMemories(enabled: boolean) {
  const memories = useQuery(listMemoriesRef, enabled ? {} : "skip") as
    | Memory[]
    | undefined;
  return {
    memories,
    updateMemory: useMutation(updateMemoryRef),
    deleteMemory: useMutation(deleteMemoryRef),
    clearMemories: useMutation(clearMemoriesRef),
  };
}

/** Edit/delete mutations without subscribing to the full memory list. */
export function useMemoryMutations() {
  return {
    updateMemory: useMutation(updateMemoryRef),
    deleteMemory: useMutation(deleteMemoryRef),
  };
}

/** Just the memories saved by one assistant turn (for the message indicator). */
export function useMemoriesByIds(ids: string[] | undefined) {
  return useQuery(
    getMemoriesByIdsRef,
    ids && ids.length > 0 ? { ids } : "skip",
  ) as Memory[] | undefined;
}

/** The memory on/off switch (defaults on), plus its setter. */
export function useMemorySettings(enabled: boolean) {
  const settings = useQuery(getMemorySettingsRef, enabled ? {} : "skip") as
    | { enabled: boolean }
    | undefined;
  return {
    settings,
    setEnabled: useMutation(setMemoryEnabledRef),
  };
}
