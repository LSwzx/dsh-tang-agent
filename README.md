# dsh-tang-agent · 三省六部工作流

> 真正的多智能体朝议：中书起草、钦天监勘验、门下封驳、尚书派发，六部各自派生独立子 Agent 并调用真实工具。
> 侧边栏只做展示与操作；编排、持久化、工具与审批全部在 Host 完成。

- **插件名**：`dsh-tang-agent`
- **形态**：DSH Bundle（Host 真实编排 + Web Client 侧边栏）
- **编排接口**：`ctx.subagents.startActivation({ provider: 'spawn' })`
- **Prompt 来源**：`prompts.py` 每次运行时动态读取（Python → JSON）
- **真实工具**：`ctx.fs` / `ctx.subprocess` / `ctx.approval` / `ctx.tools`
- **UI 数据**：`/api/tang/*` + SSE 真实事件流
- **持久化**：DSH Storage kv；无 kv 时回退到 `$DSH_HOME/tang-dynasty-agents/runs.json`

---

## 一、真实朝议流程

```mermaid
flowchart TD
    E["皇帝 · 下旨"] --> Q["钦天监 · 能力勘验"]
    Q -->|不可行| ERR["Error 折子 · 直呈御前"]
    Q -->|可行| Z["中书省 · 起草"]
    Z --> M{"门下省 · 契约审议"}
    M -->|驳回 · 未达上限| Z
    M -->|连驳达到上限| ERR
    M -->|准奏| S["尚书省 · 两波派发"]
    S -->|第一波| W["工部 · 申请写文件"]
    W --> A{"人工审批 · 侧边栏"}
    A -->|准奏| W2["工部落盘"]
    A -->|拒绝/超时| ERR
    W2 --> S2["尚书省 · 第二波"]
    S2 --> J["刑部 · 代码扫描"]
    S2 --> B["兵部 · 申请执行命令"]
    S2 --> L["礼部 · 文档读取"]
    S2 --> R["户部 · 字数/Token"]
    S2 --> P["吏部 · 分配子 Agent 角色"]
    B --> A2{"人工审批 · 侧边栏"}
    A2 -->|准奏| AGG["尚书省 · 汇总"]
    A2 -->|拒绝/超时| ERR
    J --> AGG
    L --> AGG
    R --> AGG
    P --> AGG
    W2 -->|失败| ERR
    S2 -->|严重报错| ERR
    ERR --> E
```

每个角色都是一个**独立 Agent 实例**（独立 Session、独立 System Prompt、独立工具面），
不是浏览器里的本地状态机。

### 一次运行需要多少 Agent

| 模式 | 子 Agent 数（不含承载父会话） |
| --- | --- |
| 快速问答 | 1（中书） |
| 单部直调 | 1（指定部） |
| 完整朝议 · 一次准奏 | 11（中书 + 钦天监 + 门下 + 尚书派发 + 六部 + 尚书汇总） |
| 完整朝议 · 一次驳回 | 14 |
| 完整朝议 · 连驳 3 次（封还） | 17 |

另有 1 个不调用模型的“朝议父会话”用于承载子 Agent；也可复用当前会话作为父。

---

## 二、六部真实工具

| 部 | 工具 | 实际行为 | 审批 |
| --- | --- | --- | --- |
| 工部 | `tang_works_write` / `tang_works_read` | `ctx.fs` 写/读工作区文件 | 所有写入都需侧边栏审批 |
| 刑部 | `tang_justice_scan` | 递归扫描危险模式 + `python -B -m py_compile`（argv 直传，不写 pyc） | 只读，无需审批 |
| 兵部 | `tang_war_run` | `ctx.subprocess` 执行命令，30s 默认超时 | 所有命令都需侧边栏审批 |
| 户部 | `tang_revenue_count` | 统计字符 / CJK / 拉丁词 / 行数 / 近似 Token | 只读 |
| 吏部 | `tang_personnel_assign` | 把六部条陈分配给具体子 Agent 角色 | 只读 |
| 礼部 | `tang_rites_doc` | 读取文档并提取标题、行数、摘要 | 只读 |
| 钦天监 | `tang_qintian_probe` | 探测 Host Services、工具面、子 Agent provider、planned_tools | 只读 |

**安全边界**

- 所有文件路径限制在本次 run 的 `cwd` 内；越界直接拒绝。
- 所有工部写入、兵部命令都先进入侧边栏审批队列（`run.requestApproval()`）：pending → 人类点击允许/拒绝 → 才执行；拒绝或超时即打回。
- 若插件审批队列不可用，则回退到 DSH `ctx.approval.request()`；未获 `allowed-once` 一律失败（fail-closed）。
- 子 Agent 通过 `agent.ctx.tools.restrict` 只保留 `read`；`tang_*` 是 scoped 工具，只注入对应部。
- 额外 `tools.guard` 禁止子 Agent 再派生 `subagent`，避免递归与越权。
- 第一波工部失败或第二波部门严重报错时，尚书省立即熔断，不再强行汇总，把带 `Error` 的折子直呈皇帝。


---

## 三、消息与 UI

- 浏览器通过 `POST /api/tang/run` 下旨，返回 `runId`。
- `GET /api/tang/runs/:id/stream` 是 SSE，推送真实 run 快照：阶段、Agent 状态、流式文本、工具调用、审批结果、驳回次数。
- `GET /api/tang/runs` 列出历史；`POST /api/tang/runs/:id/cancel` 取消所有子 Agent。
- 面板显示每个子 Agent 的模型、Session 短 id、实时文本、真实工具调用与结果、失败原因。
- UI 不运行任何状态机；刷新后按 `runId` 恢复。

### 会话隔离

每次朝议都会通过 `ctx.agents.create()` 新建一个**独立父会话**，并 `attachSession` 到当前工作区；中书、钦天监、门下、尚书与六部都是该父会话下的子 Agent。当前对话只收到 `tang_court` 的最终工具结果，不会混入子 Agent 的中间过程。父会话保留为新的 DSH 对话，插件卸载时才统一释放。

兵部命令统一使用 UTF-8 输出（PowerShell `$OutputEncoding` / Python `PYTHONIOENCODING`），中文路径与 stdout 不再出现 `?` 乱码。

---

## 四、模式

| 模式 | 行为 |
| --- | --- |
| 完整朝议 | 中书 → 钦天监 → 门下（可多轮）→ 尚书 → 两波派发 → 尚书汇总 |
| 单部直调 | 皇帝点名某部，跳过三省，直接派生该部 Agent |
| 快速问答 | 单次 Agent 回答，不走朝议 |

连驳上限可在 UI 选择 2 或 3，默认 3；达到上限即封还御前，不再派发六部。

### 同一任务续旨

一次朝议完成后，面板会出现 **“续旨此案”** 按钮：

1. 点击后进入续旨状态（顶部显示“续旨 · runId 短号”）；
2. 输入新的增量圣旨，再点“传旨”；
3. Host 通过 `continueFrom` 复用上一案的父会话，并把上一案的中书草案、门下朱批、六部覆命摘要注入新 run 的 Prompt；
4. 若插件重启导致父会话句柄丢失，则新建父会话，但仍通过 `run.previous` 带上上一案上下文；
5. 点“改为新案”可退出续旨状态。

也可以直接调用工具：

```json
{"edict":"把上一案的报告补上预算章节","continue_from":"tang-xxxx"}
```


---

## 五、Host 工具

- `tang_court`：启动一次真实朝议；`wait: true` 时等待并返回完整报告，`wait: false` 时返回 `runId`。
- `tang_court_status`：按 runId 查看实时状态与工具调用。
- `tang_court_cancel`：取消运行中的朝议。

参数包含 `mode`（`full` / `single` / `quick`）、`max_rejections`、`ministry`。

---

## 六、安装与启用

已发布到 npm：<https://www.npmjs.com/package/dsh-tang-agent>

```powershell
# 方式一：在 DSH 插件页直接输入包名
dsh-tang-agent

# 方式二：本地目录（开发时）
D:\dshprogram\dsh-tang-agent

# 方式三：让 DSH Agent 调用 plugin_manager install_bundle
```

> 如果“添加插件”仍提示“未找到”，通常是安装源（中国大陆镜像）尚未同步新包；切换到 npm 官方源，或直接输入本地绝对路径。
> 本地开发时也可以继续使用目录方式，npm 包与本地目录指向同一套代码。

安装后左侧栏出现朱砂“唐”印，标题为 **三省六部工作流**。刷新页面（`Ctrl+R`）加载新 Client；若仍未更新，重启 DSH。

---

## 七、测试

```powershell
python test_tang_agents.py     # 14 个 Python 参考实现用例
node scripts/smoke.mjs         # 旧确定性引擎冒烟（兼容保留）
node scripts/check-client.mjs  # Client 装配 + idle 渲染检查
node scripts/build-client.mjs  # 重建 client.js
```

真实多智能体联调已实际跑通：一次完整朝议派生 14 个子 Agent，六部均产生真实工具调用记录（见 `tang-artifacts/` 与运行起居注）。

---

## 八、已知限制

- 六部已改为**两段式波次**：第一波只派工部落盘；工部完成后第二波才派刑部、兵部、礼部、户部、吏部，户部不会在报告落盘前读取。
- 第一波失败或第二波严重报错时会**熔断**，不再强行汇总，直接生成 Error 折子呈报皇帝。
- 审批由插件的 `approval/request` answerer 推到侧边栏；拒绝或超时即打回。
- 兵部命令统一 UTF-8 输出，中文 stdout 不再乱码。
- 浏览器视觉未截图验证；已做 slot 注册、SSE 接口与 idle 渲染检查。

---

## 九、License

MIT。唐印与图标为原创绘制。
