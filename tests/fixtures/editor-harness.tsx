"use client";
import { useState } from "react";
import { Composer } from "@/components/composer";
import type { Conversation, WorkspaceMember } from "@/lib/types";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const conversationId = "10000000-0000-4000-8000-000000000003";
const members: WorkspaceMember[] = [
  {
    workspace_id: workspaceId,
    user_id: userId,
    role: "member",
    joined_at: "2026-01-01T00:00:00Z",
    profile: {
      id: userId,
      display_name: "Test Writer",
      username: "test_writer",
      avatar_url: null,
      status: "",
      status_emoji: "",
      title: "",
      bio: "",
      dnd_until: null,
    },
  },
];
const channels: Conversation[] = [
  {
    id: conversationId,
    workspace_id: workspaceId,
    name: "editor-tests",
    description: "Editor test fixture only",
    topic: "",
    kind: "public",
    created_by: userId,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];
/** No fake backend. Exercises the real editor/composer in a development-only route. */
export function EditorHarness() {
  const [sent, setSent] = useState("");
  const [failOnce, setFailOnce] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  return (
    <main className="editor-test-harness">
      <h1>Isolated editor test fixture</h1>
      <p>
        This route exists only when explicitly enabled in development. It never
        sends messages to a backend.
      </p>
      <Composer
        conversationId={conversationId}
        userId={userId}
        label="#editor-tests"
        members={members}
        channels={channels}
        persistDraft={false}
        onSend={async (body, _files, _date, id) => {
          setIds((current) => [...current, id || "missing"]);
          if (failOnce) {
            setFailOnce(false);
            throw new Error("Test transport failure.");
          }
          setSent(body);
        }}
      />
      <button type="button" onClick={() => setFailOnce(true)}>
        Fail the next test send
      </button>
      <pre data-testid="attempted-ids">{JSON.stringify(ids)}</pre>
      <pre data-testid="sent-message">{sent}</pre>
    </main>
  );
}
