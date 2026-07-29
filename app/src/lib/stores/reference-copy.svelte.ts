export type ReferenceCopyFeedbackKind = "success" | "error";

export interface ReferenceCopyFeedback {
  kind: ReferenceCopyFeedbackKind;
  message: string;
}

const FEEDBACK_DURATION_MS = 2000;

export function createReferenceCopyFeedbackStore() {
  let feedback = $state<ReferenceCopyFeedback | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    feedback = null;
  }

  function show(kind: ReferenceCopyFeedbackKind, message: string): void {
    if (timer) clearTimeout(timer);
    feedback = { kind, message };
    timer = setTimeout(clear, FEEDBACK_DURATION_MS);
  }

  return {
    get feedback() {
      return feedback;
    },
    show,
    clear,
  };
}

export const referenceCopyFeedbackStore = createReferenceCopyFeedbackStore();
