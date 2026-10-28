import { notFound } from "next/navigation";
import { EditorHarness } from "../../../tests/fixtures/editor-harness";
export default function TestEditorPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.RELAY_TEST_EDITOR !== "1"
  )
    notFound();
  return <EditorHarness />;
}
