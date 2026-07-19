export interface Command {
  id: string;
  label?: () => string;
  run: () => void | Promise<void>;
}

export interface PaletteCommand {
  id: string;
  label: string;
}

const commands = new Map<string, Command>();

export function registerCommand(command: Command): void {
  commands.set(command.id, command);
}

export function runCommand(id: string): void {
  void commands.get(id)?.run();
}

/** 動的な翻訳ラベルを持つ、ユーザー向けコマンドだけを返す。 */
export function listPaletteCommands(): PaletteCommand[] {
  return [...commands.values()]
    .filter((command): command is Command & { label: () => string } => Boolean(command.label))
    .map((command) => ({ id: command.id, label: command.label() }));
}
