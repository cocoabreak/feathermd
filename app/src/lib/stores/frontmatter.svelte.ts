export type FrontmatterData = Record<string, unknown>;

function createFrontmatterStore() {
  let data = $state<FrontmatterData | null>(null);

  return {
    get data() {
      return data;
    },
    set(value: FrontmatterData | null) {
      data = value;
    },
  };
}

export const frontmatterStore = createFrontmatterStore();
