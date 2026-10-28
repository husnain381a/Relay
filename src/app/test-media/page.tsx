import { notFound } from "next/navigation";
import { MediaHarness } from "../../../tests/fixtures/media-harness";

export default function TestMediaPage() {
  if (process.env.NODE_ENV !== "development" || process.env.RELAY_TEST_EDITOR !== "1") notFound();
  return <MediaHarness />;
}
