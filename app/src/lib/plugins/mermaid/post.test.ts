import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderAllPending } from "./post";

const { initializeMock, renderMock } = vi.hoisted(() => ({
  initializeMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe("Mermaid post renderer", () => {
  beforeEach(() => {
    initializeMock.mockClear();
    renderMock.mockReset();
    document.body.innerHTML = "";
  });

  it("正常な図をSVGとして残し、一時DOMだけを削除する", async () => {
    renderMock.mockImplementation(async (id: string) => {
      const temporary = document.createElement("div");
      temporary.id = `d${id}`;
      document.body.appendChild(temporary);
      return { svg: `<svg id="${id}" role="graphics-document"><text>Diagram</text></svg>` };
    });

    const container = document.createElement("main");
    const diagram = document.createElement("div");
    diagram.className = "mermaid-pending";
    diagram.dataset.code = encodeURIComponent("flowchart TD\n  A-->B");
    container.appendChild(diagram);
    document.body.appendChild(container);

    await renderAllPending(container, "ja");

    const renderId = renderMock.mock.calls[0][0] as string;
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", suppressErrorRendering: true })
    );
    expect(document.getElementById(`d${renderId}`)).not.toBeInTheDocument();
    expect(diagram).toHaveClass("mermaid-rendered");
    expect(diagram.querySelector("svg")).toHaveAttribute("id", renderId);
    expect(diagram.querySelector("svg")).toHaveTextContent("Diagram");
    expect(diagram.querySelector(".lightbox-trigger-button")).toBeInTheDocument();
  });

  it("構文エラー時にMermaidの一時DOMを本文外へ残さない", async () => {
    renderMock.mockImplementation(async (id: string) => {
      const temporary = document.createElement("div");
      temporary.id = `d${id}`;
      temporary.innerHTML = '<svg><text class="error-text">Syntax error in text</text></svg>';
      document.body.appendChild(temporary);
      throw new Error("Parse error");
    });

    const container = document.createElement("main");
    const diagram = document.createElement("div");
    diagram.className = "mermaid-pending";
    diagram.dataset.code = encodeURIComponent("flowchart TD\n  A-->");
    container.appendChild(diagram);
    document.body.appendChild(container);

    await renderAllPending(container, "ja");

    expect(document.body.querySelector(".error-text")).not.toBeInTheDocument();
    expect(diagram).toHaveClass("mermaid-error-container");
    expect(diagram).toHaveTextContent("Mermaid レンダリング失敗");
    expect(diagram.querySelector("pre")).toHaveTextContent("flowchart TD");
  });
});
