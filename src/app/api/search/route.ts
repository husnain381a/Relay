import type { NextRequest } from "next/server";
import { api, authenticatedClient } from "@/lib/http";
import { createRelay } from "@/lib/relay/service";
import { searchInput } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return api(async () => {
    const { client } = await authenticatedClient();
    const params = request.nextUrl.searchParams;
    const input = searchInput.parse({
      workspaceId: params.get("workspaceId"),
      query: params.get("q"),
      conversationId: params.get("conversationId") ?? undefined,
      authorId: params.get("authorId") ?? undefined,
      before: params.get("before") ?? undefined,
      limit: Number(params.get("limit") ?? 30),
      offset: Number(params.get("offset") ?? 0),
    });
    return createRelay(() => client).search(
      input.workspaceId,
      input.query,
      input,
    );
  });
}
