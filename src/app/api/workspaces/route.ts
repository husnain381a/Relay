import type { NextRequest } from "next/server";
import {
  api,
  assertSameOrigin,
  authenticatedClient,
  readJson,
} from "@/lib/http";
import { createRelay } from "@/lib/relay/service";
import { workspaceInput } from "@/lib/validation";

export async function GET() {
  return api(async () => {
    const { client } = await authenticatedClient();
    return createRelay(() => client).workspaces();
  });
}
export async function POST(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const { client } = await authenticatedClient();
    const input = workspaceInput.parse(await readJson(request));
    return createRelay(() => client).createWorkspace(input.name);
  });
}
