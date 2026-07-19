import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

// globals: false のため @testing-library/svelte の自動cleanupが効かない。
// テストごとに明示的にDOMを片付ける。
afterEach(() => {
  cleanup();
});
