import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

export interface ResumeCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export function buildResumeCommand(sessionId: string, cwd?: string): ResumeCommand {
  return {
    command: 'claude.cmd',
    args: ['--resume', sessionId],
    cwd,
  };
}

export class ResumeError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'ResumeError';
  }
}

export function resumeSession(sessionId: string, cwd?: string): number {
  // 兜底：cwd 可能指向已删除目录
  const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const { command, args } = buildResumeCommand(sessionId, safeCwd);
  try {
    // shell:true 让 Windows 能找到 claude.cmd；detached + unref 不阻塞 Electron 主进程
    const child = spawn(command, args, {
      cwd: safeCwd,
      shell: true,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (e) => {
      // Cannot surface to caller from a fire-and-forget spawn, but the error
      // will appear in stderr / main process console. UI will see pid=0 and treat as failure.
      console.error('Resume spawn error:', e);
    });
    child.unref();
    return child.pid ?? 0;
  } catch (e) {
    throw new ResumeError(
      `Failed to launch claude.cmd --resume ${sessionId}: ${e instanceof Error ? e.message : String(e)}`,
      e
    );
  }
}
