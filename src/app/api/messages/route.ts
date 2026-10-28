import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  api,
  assertSameOrigin,
  authenticatedClient,
  readJson,
} from "@/lib/http";
import { createRelay } from "@/lib/relay/service";
import { messageBody, messageInput, uuid } from "@/lib/validation";

export async function POST(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const { client } = await authenticatedClient();
    const input = messageInput.parse(await readJson(request));
    return createRelay(() => client).sendMessage(input);
  });
}
export async function PATCH(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const { client } = await authenticatedClient();
    const input = z
      .object({ id: uuid, body: messageBody })
      .parse(await readJson(request));
    await createRelay(() => client).editMessage(input.id, input.body);
    return { updated: true };
  });
}
export async function DELETE(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const { client } = await authenticatedClient();
    const input = z.object({ id: uuid }).parse(await readJson(request));
    await createRelay(() => client).deleteMessage(input.id);
    return { deleted: true };
  });
}
