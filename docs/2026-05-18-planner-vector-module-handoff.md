# EnaPlanner 向量知识库模块接力记录

日期：2026-05-18

## 问题现象

在 EnaPlanner 改成统一模块链后，用户观察到：

- `VectorsEnhanced` 仍能成功查询；
- 但进入 EnaPlanner 提示词链时，看起来只剩下一个被搜寻到的向量知识块；
- 期望行为是：向量知识库搜回多少块，`VectorsEnhanced` 模块就完整承载多少块，不在 EnaPlanner 侧再次收缩。

## 排查结论

当前链路里：

1. `EnaPlanner` 调用 `window.VectorsEnhanced.queryForPrompt()`；
2. `VectorsEnhanced` 返回：
   - `text`
   - `rawText`
   - `results[]`
   - `stats`
3. EnaPlanner 之前只取 `result.text || result.rawText` 作为模块正文。

理论上 `rawText` 应该已经包含全部命中块；但如果聚合文本在格式化过程中漏掉任意块，EnaPlanner 就会把这个“已经变窄的正文”直接送进模块链。  
因此这次修复没有改召回策略，而是在 EnaPlanner 接入层补上完整性兜底。

## 已完成修改

文件：

- `modules/ena-planner/ena-planner.js`

新增：

- `getVectorKnowledgeBlocks(result)`
  - 从 `result.results[]` 提取所有非空命中块正文。
- `buildVectorKnowledgeBody(result)`
  - 优先使用 `rawText/text`；
  - 但会检查聚合正文是否真的包含 `results[]` 中的每一个块；
  - 如果有任意命中块未被正文承载，则退回到 `results[]` 全量拼接。

调整：

- `buildVectorsEnhancedKnowledge()`
  - 不再直接只取 `result.text || result.rawText`；
  - 改为使用 `buildVectorKnowledgeBody(result)`；
  - `stats` 增加 `carriedCount`，表示本次模块实际承载的向量块数。

## 设计意图

- 不改 `VectorsEnhanced` 的：
  - 任务选择
  - 权重
  - 阈值
  - 最大召回数
  - rerank
- 只保证 EnaPlanner 模块层不把上游多块召回压成单块。
- 也就是说：  
  `VectorsEnhanced` 决定“搜多少”；  
  `EnaPlanner` 负责“搜回多少就接住多少”。

## 已做验证

- `node --check modules/ena-planner/ena-planner.js` 通过。
- 用简化样例验证：
  - 若 `rawText` 只含 `A`，但 `results[] = [A, B, C]`，最终正文会回填为 `A / B / C`；
  - 若 `rawText` 已完整包含 `A / B / C`，则保留原有聚合正文，不重复加工。

## 仍需人工确认

在真实 SillyTavern 页面里再做一次烟测：

1. 打开 EnaPlanner 的 `VectorsEnhanced` 模块；
2. 把聊天记录管理器 `max_results` 设为大于 1；
3. 触发一次能命中多块的查询；
4. 看“真实发送预览”里的 `<planner_vector_knowledge>`：
   - 是否实际包含多块内容；
   - 是否与 VectorsEnhanced 查询结果数量一致；
5. 看 toast 中的返回块数，以及真实 request messages 是否一致。

## 当前仓库状态

截至记录时，未提交修改：

- `modules/ena-planner/ena-planner.js`

如果后续仍只出现一块，下一步应重点检查 `vectors-enhanced/index.js` 中：

- `queryForPrompt()`
- `formatPlannerQueryResults()`
- `results[]` 是否本身就只剩一项

因为那时问题就已经发生在 EnaPlanner 之前，而不是模块链接入层。
