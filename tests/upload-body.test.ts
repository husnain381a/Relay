import { expect, it } from "vitest";
import { readBytes } from "../src/lib/http-security";
it("rejects an upload stream that exceeds its declared Content-Length and memory budget", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2048));
      controller.enqueue(new Uint8Array(2048));
      controller.close();
    },
  });
  const request = new Request("https://relay.example/api/files", {
    method: "POST",
    headers: { "content-length": "1" },
    body,
    duplex: "half",
  } as RequestInit);
  await expect(readBytes(request, 3000)).rejects.toMatchObject({ status: 413 });
});
