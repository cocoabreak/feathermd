function createSessionRestorePromptStore() {
  let visible = $state(false);

  return {
    get visible() {
      return visible;
    },
    show() {
      visible = true;
    },
    hide() {
      visible = false;
    },
  };
}

export const sessionRestorePromptStore = createSessionRestorePromptStore();
