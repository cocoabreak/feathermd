import { beforeEach, describe, expect, it } from "vitest";
import {
  approveExternalImagesForDocument,
  areExternalImagesApprovedForDocument,
  clearExternalImageApprovals,
} from "./external-image-permission";

describe("external image permissions", () => {
  beforeEach(clearExternalImageApprovals);

  it("許可を文書パス単位で保持する", () => {
    approveExternalImagesForDocument("C:/notes/a.md");
    expect(areExternalImagesApprovedForDocument("C:/notes/a.md")).toBe(true);
    expect(areExternalImagesApprovedForDocument("C:/notes/b.md")).toBe(false);
  });
});
