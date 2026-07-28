# _template/ — v5 wave-0 模块骨架模板

## 是什么

这是 v5 模块化架构的 `_template` 模板,**placeholder skeleton**,用于统一
波 1+ 业务模块(MCP / Skills / Commands / Sub-Agents / Hooks / Plugins /
Profiles / Analytics)的实现风格。

文件清单(共 5 文件):

| 文件 | 作用 |
|---|---|
| `types.ts` | 占位类型 `ModuleRow` / `ModuleWriteInput`,波 1+ 模块替换为真实 row/input/output |
| `scanner.ts` | 占位扫描函数 `scan(): unknown[]`,波 1+ 替换为真实目录扫描 / JSONL 解析 |
| `writer.ts` | 占位写入函数 `write(input): void`,波 1+ 替换为真实 JSONL / DB row / 文件覆盖 |
| `index.ts` | 聚合导出上述 3 文件的全部 named export |
| `README.md` | 本文件 |

## 设计原则

- **Simplicity First** — 占位骨架**只写契约,不写实现**。波 1+ 模块基于此替换。
- **不抛 'not implemented'** — 占位函数返 `[]` / `void` 而不是 throw,避免
  `_template` 被其他模块引用时引入二次失败。
- **JSDoc 必填** — 每个占位函数都要在 JSDoc 里说明"波 1+ 哪个模块会替换它"
  以及"替换后返什么"。方便后续 dev 接手时一眼定位。

## 怎么用(波 1+ 模块作者)

```bash
# 1. 复制 _template 到目标模块目录
cp -r electron/repo/_template electron/repo/mcp
rm electron/repo/mcp/README.md  # 替换为本模块自己的 README

# 2. 重命名占位符号
#    ModuleRow      → McpServerRow
#    ModuleWriteInput → McpWriteInput
#    scan()         → scanMcpServers() (或保留 scan,如果模块语义通用)
#    write()        → writeMcpServer() (或保留 write)

# 3. 在 scan() / write() 中实现真实逻辑

# 4. 更新 electron/repo/index.ts 聚合导出:
#    export * from './mcp';
```

## 测试

`tests/template.test.ts` 7 case 覆盖:

1. `types.ts` 导出占位类型符号
2. `scanner.ts` 导出 `scan()` 函数,返 `[]`
3. `writer.ts` 导出 `write()` 函数,返 `void`
4. `index.ts` 聚合导出 `scan` + `write` 符号
5. `README.md` 含 6 关键词:`template` / `skeleton` / `module` / `placeholder` / `wave-0` / `v5`
6. `_template/` 目录文件清单精确为 5 个(README.md + 4 .ts)
7. 所有 .ts 文件在 JSDoc 头部含 `placeholder` / `skeleton` / `template` 关键词

## 不要做什么

- ❌ 不要在 `_template/` 里写任何真实业务逻辑(留给波 1+ 业务模块)
- ❌ 不要修改 `_template/` 后让现有 31 测试挂(占位函数返 `[]` / `void`,必须)
- ❌ 不要把 `_template/` 当成可运行的业务模块 — 它是给 dev 抄的样板