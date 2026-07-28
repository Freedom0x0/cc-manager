// v4 调整:resumer 改为只生成命令字符串,不在主进程里 spawn claude.cmd。
// 原因:Electron 主进程 spawn 子进程会脱离主进程生命周期,失败/成功都难回调,
// 而且 claude.cmd 在 Windows 下需要用户 shell 环境,直接 spawn 易丢 PATH。
// 改用方案:把 `claude --resume <sessionId>` 拼成字符串返回给前端,
// 用户在系统终端里复制粘贴执行。这样:
// - 保留会话 cwd(命令可在该 cwd 下执行,需要的话前端把 cwd 拼到命令后)
// - 用户能看到命令,失败能立刻知道原因
// - 不破坏现有 IPC 链(resume_session channel 保留,只改返回类型)

export interface ResumeCommand {
  command: string;
  cwd?: string;
}

export function buildResumeCommand(sessionId: string, cwd?: string): ResumeCommand {
  return {
    command: `claude --resume ${sessionId}`,
    cwd,
  };
}

export function buildResumeCommandString(sessionId: string, cwd?: string): string {
  const { command, cwd: c } = buildResumeCommand(sessionId, cwd);
  if (!c) return command;
  return `${command}    # cwd: ${c}`;
}

// [停用 2026-07-28 v4 改返回命令字符串] 保留旧 spawn 入口以备回退
// import { spawn } from 'child_process';
// import * as fs from 'fs';
// import * as os from 'os';
//
// export function resumeSession(sessionId: string, cwd?: string): number {
//   const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
//   const { command, args } = buildResumeCommand(sessionId, safeCwd);
//   try {
//     const child = spawn(command, args, {
//       cwd: safeCwd,
//       shell: true,
//       detached: true,
//       stdio: 'ignore',
//     });
//     child.on('error', (e) => console.error('Resume spawn error:', e));
//     child.unref();
//     return child.pid ?? 0;
//   } catch (e) {
//     throw new ResumeError(
//       `Failed to launch claude --resume ${sessionId}: ${e instanceof Error ? e.message : String(e)}`,
//       e
//     );
//   }
// }
//
// export class ResumeError extends Error { ... }
