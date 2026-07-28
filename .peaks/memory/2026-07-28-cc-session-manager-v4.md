---
title: cc-session-manager v4 修复
kind: project
created: 2026-07-28
tags: [v4, folder-semantics, content-blocks, resume-command]
---

# v4 修复(3 个用户反馈 + 1 个新功能)

## 三个用户反馈
1. **项目栏 60+ 项目,实际 10 个 folder**:scanner 把每个 jsonl 的 cwd 当独立 project。
2. **消息空框**:parser 只保留 text 块,tool_use/tool_result/thinking 全丢。
3. **继续会话不工作**:Electron 主进程 spawn 子进程脱离主进程生命周期,失败无回调。

## 修复 + 1 个新功能
1. **folder 语义**:`scanProjectFolders` 只扫 folder 一级;`importProjectFolder` 走 folder 入库;project.name 走 `path.basename(cwd)`;sessions.cwd 存真实路径
2. **content blocks**:parser 返回 `{content, blocks: ContentBlock[]}`,schema 加 `messages.content_blocks JSON`;MessageView 按 type 渲染(text / tool_use / tool_result / thinking)
3. **命令卡片**:`resumer.ts` 注释 spawn,改返回 `ResumeCommand` 字符串;新组件 `ResumeCommandCard`(navigator.clipboard + execCommand 降级);MessageView 去掉"继续会话"按钮

## 关键 schema 改动
- `projects.cwd TEXT` + `projects.is_archived INTEGER DEFAULT 0`
- `sessions.cwd TEXT`
- `messages.content_blocks TEXT`(JSON)
- 4 列都有 ALTER 兼容迁移(在 `initDB` 里 `PRAGMA table_info` 检测)

## 关键决策
- **删 cluster.ts / cluster.test.ts**:v4 不再做 folder 编码名反推(`cc-session-manager` 这类连字符项目在 v2 踩过坑,改用 `path.basename(cwd)` 单源)
- **archiveLegacyFakeProjects**:启动时一次性把 v1-v3 的 cwd-style 假 project 标 `is_archived=1`,UI 不显示
- **resumer 注释而非删除**:`// [停用 2026-07-28 v4 ...]` 保留 spawn 代码,以后可恢复

## 测试
- 27 → 28 个 case,全绿
- 新增 case 覆盖:scanProjectFolders / importProjectFolder / sessions.cwd / archiveLegacy / parser 3 种 block 形态 / resumer 新 API

## 教训
- v2 反复"加规则"反推路径的思路行不通(连字符项目不可区分),直接读真实 cwd 是正解
- Electron 主进程 spawn 子进程不可控,让用户自己在终端执行更稳
- 用户认知 ≠ 算法正确性:把"项目"理解成"folder 末段"而不是"路径分析的最优切分"

## 范围外(v5 再做)
- session 标题手动编辑(用户 v4 提的剩余需求)
- antd `Bubble` 替换 MessageView 手写 div
