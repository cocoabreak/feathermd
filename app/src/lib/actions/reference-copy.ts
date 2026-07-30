import { i18n } from "$lib/i18n/index.svelte";
import { formatReference, type ReferenceFormat, type ReferenceTarget } from "$lib/reference-copy";
import { referenceCopyFeedbackStore } from "$lib/stores/reference-copy.svelte";

export async function copyReference(
  format: ReferenceFormat,
  target: ReferenceTarget
): Promise<boolean> {
  try {
    const reference = formatReference(format, target);
    await navigator.clipboard.writeText(reference);
    referenceCopyFeedbackStore.show("success", i18n.m.referenceCopy.copied);
    return true;
  } catch (error) {
    console.warn("reference copy failed:", error);
    referenceCopyFeedbackStore.show("error", i18n.m.referenceCopy.failed);
    return false;
  }
}
