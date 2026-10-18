import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("ignore les valeurs falsy", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
