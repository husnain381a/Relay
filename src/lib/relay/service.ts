import { createFiles } from "./files";
import { createMutations } from "./mutations";
import { createQueries } from "./queries";
import { createCollectionQueries } from "./collections";
import { createCollaboration } from "./collaboration";
import type { ClientFactory } from "./shared";
export function createRelay(getClient: ClientFactory) {
  return {
    ...createCollectionQueries(getClient),
    ...createCollaboration(getClient),
    ...createQueries(getClient),
    ...createMutations(getClient),
    ...createFiles(getClient),
  };
}
export type RelayService = ReturnType<typeof createRelay>;
