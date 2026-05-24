# EnaPlanner 骰子系统调查记录

## 已确认

- 实际项目根目录为 `d:\Github_All\stx相关\LittleWhiteBox`。
- 仓库当前分支为 `main`，跟踪 `relax-sketch/main`。
- 最近历史包含两次骰子功能提交及其回退：
  - `a5b69f3` Add optional dice rules to Ena Planner
  - `181016f` Make Ena dice rules an editable prompt module
  - `9071d7f` Revert "Make Ena dice rules an editable prompt module"
  - `8550e89` Revert "Add optional dice rules to Ena Planner"
- 当前已定位主要 EnaPlanner 文件：
  - `modules/ena-planner/ena-planner.js`
  - `modules/ena-planner/ena-planner.html`
  - `modules/ena-planner/ena-planner-presets.js`
  - `modules/ena-planner/ena-planner.css`
- `settings.html` 与 `index.js` 将 `enaPlanner` 作为 LittleWhiteBox 模块整体的开关和设置入口，模块状态写入 `extension_settings[EXT_ID]` 并调用 `saveSettingsDebounced()`。
- EnaPlanner 设置页当前已有“提示词”视图，声明其模块顺序即实际发送顺序；`moduleChain` 可移动、启停，支持 `builtin` 与 `promptBlock` 两种项。
- 提示词模板当前保存 `promptBlocks` 与 `moduleChain` 的深拷贝，并可恢复默认；骰子提示若作为链内模块，必须纳入这一模板生命周期。
- `package.json` 当前没有 EnaPlanner 专属测试脚本；历史骰子提交曾新增 `modules/ena-planner/tests/dice-system.test.js`。
- EnaPlanner 自身的配置不使用外层 `extension_settings[EXT_ID].enaPlanner` 保存细项；`loadConfig()` / `saveConfigNow()` 通过 `EnaPlannerStorage` 保存 `config` 与日志。外层设置只负责整个 EnaPlanner 功能入口的启用状态。
- `getDefaultSettings()` 生成 `promptBlocks`、`moduleChain` 与 `promptTemplates`；`ensureSettings()` 深合并默认值、归一化旧模板和链，并负责迁移旧键。
- 当前 builtin 模块键是 `charCard`、`worldbook`、`storyOutline`、`recentChat`、`storySummary`、`vectorsEnhanced`、`westWorldDirector`、`previousPlots`、`userInput`。普通可编辑提示词以 `promptBlock` 表示。
- `buildPlannerMessages(rawUserInput)` 遍历 `s.moduleChain`，在所在顺序把 builtin 或经过 `renderTemplateAll(...)` 处理的提示词块加入规划 API 消息；这就是骰子模块顺序控制必须接入的位置。
- 宏/模板最终由 `renderTemplateAll(...)` 经 SillyTavern 的 `substituteParamsExtended(...)` 处理；骰子同轮复用必须只对带骰子宏的提示词执行一次这一解析，再缓存解析后的文本用于空回。
- `runPlanningOnce()` 调用消息构造、规划 API 和 `filterPlannerForInput()`；`doInterceptAndPlanThenSend()` 目前直接将 `raw + filtered` 写回正文输入并触发原发送。因此“过滤后为空”的兜底挂点位于拦截发送完成规划之后，而复用数据必须从消息构造阶段返回。
- `renderTemplateAll()` 的顺序是 EJS -> `substituteParamsExtended()` -> 消息变量宏；任何包含骰子宏的块只要进入规划构造或预览构造就可能产生骰点。
- `filterPlannerForInput()` 先剔除 `<think>/<thinking>`，优先保留配置标签；若不存在可保留标签则回退保留其余非思考文本。因此空回是其最终字符串为空，而不是“没输出 `<plot>`”。
- 设置页的“真实发送预览”使用临时配置直接调用 `buildPlannerMessages()`；若骰子模块启用，预览应展示已解析点数，但它与后续正式发送是不同的一次构造。
- `EnaPlannerStorage` 写入服务器文件 `LittleWhiteBox_EnaPlanner.json`，其 `config` 对象将是独立开关、模块块内容、模块顺序和模板的持久化承载。
- `a5b69f3` 的首版补丁将骰子提示固定前置于模块链之外，满足单轮一次解析及空回复用，但不满足可排序/可编辑要求。
- `181016f` 的第二版补丁把专用骰子提示块放入 `promptBlocks/moduleChain` 并在遍历链时解析，意图满足排序与编辑；其实现被随后回退，不能视为已确认方案。
- 第二版回退补丁强制专用骰子块存在、固定为 `system`、不可单独删除或通过链条 toggle 关闭（启用由基本设置控制），这是可考虑的数据一致性策略。
- 第二版示例骰子宏写成 `{{roll 1d20}}`，与用户给出的 `{{roll:1d20}}` 不同；必须继续从本地 SillyTavern 源码确认有效语法，不能沿用未验证写法。
- `SillyTavern-1.15.0/public/script.js` 中 `substituteParamsExtended()` 转发给 `substituteParams()`；默认非实验路径最终调用 `evaluateMacros()`。
- 当前 SillyTavern 默认宏实现 `public/scripts/macros.js` 定义 `rollPattern = /{{roll[ : ]([^}]+)}}/gi`，所以单冒号 `{{roll:1d20}}` 和空格 `{{roll 1d20}}` 在默认引擎都可解析。默认提示词应忠实保留用户提供的单冒号形式。
- `power_user.experimental_macro_engine` 默认是 `false`，启用时会走新的宏引擎；该引擎在 `public/scripts/macros/definitions/core-macros.js` 也注册 `roll`。
- 实验宏解析器 `MacroParser` 在宏名后允许单个可选冒号并读取后续参数，所以用户给出的无空格单冒号 `{{roll:1d20}}` 也在实验路径可解析。
- 当前仓库没有 EnaPlanner 测试目录；若实现通过批准，应新增可独立运行的纯逻辑测试，并将其纳入明确的验证命令或 `package.json` 脚本。

## 设计必须覆盖的边界

- 新安装、既有配置、保存模板及恢复默认时，骰子模块的存在、位置、内容和 master switch 必须一致。
- 正式发送时，骰子内容须只解析一次；规划 API 接收该解析文本，过滤结果为空时正文输入复用同一字符串。
- 正常规划结果非空时，不应把完整骰子规则再次附加给正文；正文仅接收规划产出的裁定信息。
- 预览/测试生成的点数必须标明不是之后实际发送的同轮点数。
- 测试需要覆盖开关、排序、编辑持久化、默认/已有配置迁移、正常路径、空回路径及不重掷断言。

## 用户确认

- 默认骰子提示词采用用户已提供的规则内容，初始骰池只有 `D20: [{{roll:1d20}}, ...]` 共 10 个骰点；之后用户可在设置页编辑保存。
- 选择受保护模块模式：骰子规则模块始终存在于 `moduleChain`，可以调整顺序与内容，但没有删除或模块级关闭操作；基本设置开关是唯一生效开关。
- 空回正文兜底采用现有“写回输入再放行发送”机制：只把同一次规划构造阶段得到的已解析骰子提示文本追加给正文模型，不重新渲染模板或解析宏。
- 用户确认采用“受保护专用 `promptBlock` + 单轮解析上下文”实现路径。
- 用户确认配置与模块链设计：`diceSystem.enabled` 独立全局保存；骰子块随提示词模板保存顺序和编辑内容，角色/身份受保护；迁移只补缺失块，不覆盖已有内容与顺序。
- 用户修订运行时策略：规划 API 空响应、抛错或超时均视作无可用规划输出，并将同轮解析后的骰池作为正文兜底指令发出。
- 根据现有/设计调用顺序，`buildPlannerMessages()` 完成（含骰子解析）后才进入 `callPlanner()`；故规划 API 的空响应、异常或超时发生时骰池必然已经生成，无需新增“故障后首次生成”分支。
- 设计限定 EnaPlanner 只兜底规划阶段无法得到内容的情形；正文请求已放行提交后的失败不自动重发，以避免无法判断服务器是否已生成而产生重复回复。
- 用户已批准 `docs/superpowers/specs/2026-05-24-ena-planner-dice-system-design.md`，实现应严格覆盖其中的主开关、受保护链内模块、同轮一次解析复用和规划异常兜底边界。
- 实现中的模板/配置迁移以 `ensureDicePromptModule()` 为单一约束点：旧模板缺块时插入一次，已有块的内容与位置不被默认文本覆盖，同时固定其 `system` 身份与启用标记。
- 运行时在 `buildPlannerMessages()` 遍历骰子块时生成 `diceFallbackPrompt`，并在 `callPlanner()` 之前完成；`runPlanningOnce()` 的 API 异常恢复分支只返回该字符串，不会再次调用模板或宏渲染。
- 设置页的骰子卡片对用户仅暴露内容编辑与上下移动操作；其名称、`system` 身份、删除/启用限制由 UI 与保存后的运行时归一化共同保证。
- `callPlanner()` 只从运行选项读取 `onDelta`，`allowDiceFallbackOnError` 不会被序列化进 API body；规划失败兜底仅由 `runPlanningOnce()` 控制。
- 当前会话没有可用的 Browser 执行表面或正在运行的 SillyTavern 页面；因此 live UI 和实际网络失败路径需在宿主运行环境中进一步点验。
