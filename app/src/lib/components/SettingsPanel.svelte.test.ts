import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { i18n } from "$lib/i18n/index.svelte";
import SettingsPanel from "./SettingsPanel.svelte";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("SettingsPanel", () => {
  beforeEach(() => {
    i18n.setLocale("ja");
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_shell_integration_status") {
        return { supported: true, registered: false };
      }
      if (command === "set_shell_integration_enabled") {
        return { supported: true, registered: true };
      }
      return null;
    });
  });

  it("4カテゴリを表示し、表示を初期カテゴリにする", () => {
    render(SettingsPanel, { onclose: vi.fn() });

    const navigation = screen.getByRole("navigation", { name: "設定カテゴリ" });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "ファイル" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "プライバシー" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "レンダラー" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "表示" })).toBeInTheDocument();
    expect(screen.getByText("アプリ").closest("details")).toHaveAttribute("open");
  });

  it("カテゴリを切り替えて対応する設定だけを表示する", async () => {
    render(SettingsPanel, { onclose: vi.fn() });

    const filesButton = screen.getByRole("button", { name: "ファイル" });
    await fireEvent.click(filesButton);

    expect(filesButton).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 3, name: "ファイル" })).toBeInTheDocument();
    expect(screen.getByText("外部エディターの実行ファイル")).toBeInTheDocument();
    expect(screen.queryByText("アプリのテーマ")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "プライバシー" }));
    expect(screen.getByText("外部画像")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "レンダラー" }));
    expect(screen.getByText("レンダラープラグイン")).toBeInTheDocument();
  });

  it("Windows右クリック登録を実状態から表示して切り替える", async () => {
    render(SettingsPanel, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "ファイル" }));

    const checkbox = await screen.findByRole("checkbox", {
      name: "右クリックに「FeatherMDで開く」を追加",
    });
    await waitFor(() => expect(checkbox).not.toBeChecked());

    await fireEvent.click(checkbox);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_shell_integration_enabled", {
        enabled: true,
      });
      expect(checkbox).toBeChecked();
    });
  });

  it("Windows連携の変更と再取得が失敗しても実状態とローカライズ済みエラーを表示する", async () => {
    i18n.setLocale("en");
    let statusCalls = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_shell_integration_status") {
        statusCalls += 1;
        if (statusCalls === 1) return { supported: true, registered: false };
        throw new Error("レジストリ状態を取得できません");
      }
      if (command === "set_shell_integration_enabled") {
        throw new Error("レジストリへ書き込めません");
      }
      return null;
    });

    render(SettingsPanel, { onclose: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "Files" }));
    const checkbox = await screen.findByRole("checkbox", {
      name: 'Add "Open with FeatherMD" to the context menu',
    });
    await fireEvent.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not change Windows integration"
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("レジストリ");
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });
});
