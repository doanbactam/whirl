export type McpLifecycleMetadata = {
  action?: string;
  completed?: string;
};

type McpMetadataServer = {
  name: string;
  tools?: {
    name: string;
    description: string;
    completed?: string;
  }[];
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

function sameName(left: string, right: string): boolean {
  return (
    left.trim().toLowerCase() === right.trim().toLowerCase() ||
    slugify(left) === slugify(right)
  );
}

/**
 * Resolve developer-configured lifecycle copy without assuming any provider.
 * Google Sheets and Linear are ordinary fixtures; custom MCP servers without
 * store metadata intentionally return an empty object for the generic UI path.
 */
export function resolveMcpLifecycleMetadata(
  servers: McpMetadataServer[],
  serverName: string,
  toolName: string,
): McpLifecycleMetadata {
  const server = servers.find((candidate) =>
    sameName(candidate.name, serverName),
  );
  const tool = server?.tools?.find((candidate) =>
    sameName(candidate.name, toolName),
  );
  const action = tool?.description.trim();
  const completed = tool?.completed?.trim();
  return {
    ...(action ? { action } : {}),
    ...(completed ? { completed } : {}),
  };
}
