import "server-only";
import type { SourcesDeps } from "@/modules/sources";
import { getOfferDeps } from "./offers-deps";

export function getSourcesDeps(): SourcesDeps {
  return getOfferDeps();
}
