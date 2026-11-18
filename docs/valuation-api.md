# 后端房产估价接口

`aiChat` 提供 `createEvaluation` 和 `getEvaluation` 两个 action，支持单套房产和小区参考估价。后端读取数据、计算基准价、检索知识、调用模型、校验结构化结果并保存报告。单套分析页、小区指南和 PDF 已接入同一份结构化报告；导出时冻结当前快照，不重新调用模型。页面及演示验证见 [本地估价与真实联调](local-valuation-demo.md)。

不带 `action` 的原有 `{ communityId, question, context }` 请求继续走 `legacy.js`，保持 `{ ok, content, usage, knowledgeUsed }` 文字解读响应。旧接口中的客户端价格不进入新估价流程。

## 部署准备

1. 当前项目使用 AppID `wxd7de022f6aec48c3`，`app.js` 初始化云环境 `cloud1-d5goolz85db8bfa79`；已验证模拟器能读取真实房源数据库。数据库可读与云函数部署、模型调用是分别验证的事项，不能以首页统计成功代替后两项验收。
2. 准备 `communities`、`houses`、`ai_config`、`ai_knowledge`、`valuation_reports` 集合。配置、知识和评估记录由云函数访问；尤其 `valuation_reports` 含数据快照及调用者标识，设置为客户端不可直接读写。报告通过 `getEvaluation` 按微信 OPENID 校验后返回。
3. 在云函数环境变量配置 `DEEPSEEK_KEY`。密钥不得放到前端、`ai_config`、测试数据或 Git。
4. 在 `ai_config/main` 配置供应商当前可用且支持 Chat Completions JSON 模式的模型名称。默认 `deepseek-chat` 已在本页记录的真实调用中验证；更换账号或模型时仍需重新核对可用性。首期实现 DeepSeek 适配器，其余供应商会明确报配置错误。
5. 按下节构建扁平部署包，再通过官方开发工具 CLI 上传并云端安装依赖。源码保留在 `cloudfunctions/aiChat` 的多层目录中。当前云端运行时为 Node.js 16.13，已逐项检查所用语法、内置 `https` / `crypto` / `URL` API 及依赖兼容性；构建目标同为 `node16.13`。模型适配器使用内置 `https`，不依赖 Node.js 18 才提供的全局 `fetch`。
6. 线上云函数执行超时为 60 秒。默认应用请求预算仍为 25 秒，前端等待上限为 35 秒；预算需覆盖数据读取、模型请求及报告保存，不能只延长云函数超时。数据库写入仍受实际云 SDK 和平台时限限制。`requestBudgetMs` 不能代替云函数控制台的超时设置。
7. 数据样本查询使用 `city/community` 过滤并按 `_id` 排序，知识使用 `enabled/city` 过滤并按 `_id` 排序；如环境要求复合索引，按云端索引提示创建。

接口直接通过小程序云函数调用，必须具有真实 `cloud.getWXContext().OPENID`。微信平台会向事件附加 `userInfo` 和 `tcbContext`；结构化接口入口先剥离这两类传输元数据，再对业务字段执行严格校验。调用者身份仍只取 `cloud.getWXContext().OPENID`，不信任 `userInfo.openId`、`tcbContext`、客户端 `owner` 或其他身份字段。云控制台直接测试如果没有微信调用上下文会返回 `UNAUTHORIZED`；本地测试则通过依赖注入提供测试身份。

## 构建与上传

在仓库根目录安装开发依赖并构建：

```bash
npm install
npm run build:aichat:deploy
```

`scripts/build-aichat-deploy.cjs` 将本地业务模块打包成 `tmp/deploy/aiChat/index.js`，同时生成仅含生产依赖的 `package.json`。部署目录只有这两个文件，不包含测试目录、构建工具、环境文件或密钥；`wx-server-sdk` 保持外部依赖，由云端安装。构建检查入口请求校验、平台元数据兼容处理、WXContext 身份隔离及打包前后行为一致性。构建成功本身不表示已上传或已完成真实模型联调。

当前开发工具直接递归上传多层源码时出现 `EISDIR`，使用官方 CLI 的 `--paths` 指向扁平产物：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloud1-d5goolz85db8bfa79 \
  --paths "$PWD/tmp/deploy/aiChat" \
  --appid wxd7de022f6aec48c3 \
  --remote-npm-install
```

路径随本机检出位置调整，末级目录名必须为 `aiChat`，CLI 按目录名确定云函数名。保留 `cloudfunctions/aiChat/lib` 等源码结构，每次修改源码后重新构建；不要手改生成的 `tmp/deploy/aiChat/index.js`。上传完成后还需从模拟器验证新版 action、真实模型输出及 PDF，不能只看 CLI 上传回执。

## 创建单套评估

```js
const { result } = await wx.cloud.callFunction({
  name: 'aiChat',
  data: {
    action: 'createEvaluation',
    targetType: 'house',
    houseId: '实际 houses 文档 ID',
    purpose: 'investment',
    requestId: '每次新评估生成唯一 ID'
  }
})
```

`purpose` 可为 `investment`、`rigid`、`improvement`，默认 `investment`。本阶段仅记录用途，不把用途传入市场价值提示词，也未实现三类人群评分；买方和处置意见为通用分析。

房源应有 `communityId` 或 `community_id`。也可由客户端补充 `communityId`，但后端会核对城市、小区名和已有关联。没有关联 ID 时，只允许根据城市与小区名唯一匹配；歧义会返回错误。

可选 `overrides` 用于真实人工补录：

```json
{
  "areaSqm": 89.5,
  "floor": 12,
  "totalFloors": 26,
  "rooms": 3,
  "orientation": "南",
  "decoration": "精装",
  "elevator": true,
  "buildYear": 2018,
  "occupancy": "待现场核实",
  "deliveryStatus": "以拍卖公告为准"
}
```

补录来源记录为 `user_override`，不允许补录评估价格、供应商、密钥或任意提示词。面积必须是有限正数；楼层、房间数、建成年份为整数。`orientation` 最多 60 字，`decoration/occupancy` 最多 120 字，`deliveryStatus` 最多 200 字。

小区参考估价使用 `{ action: 'createEvaluation', targetType: 'community', communityId, requestId }`，不传 `houseId` 和 `overrides`。小区结果没有单套面积和总价。

## 结果结构和状态

成功完成流程返回 `{ ok: true, report }`。`ok` 仅代表流程完成，不代表模型已经通过业务复核；调用方必须检查 `report.status` 和 `effectiveSource`。

| 字段 | 说明 |
|---|---|
| `valuationId` | 已保存报告编号 |
| `target` | 房产标识、属性及人工补录来源，不含联系人或完整原始房源文档 |
| `baselineUnitPrice` | 后端公式基准单价，元/㎡，缺失为 null |
| `modelUnitPrice` | 校验通过的模型候选单价，缺失为 null |
| `effectiveUnitPrice` / `effectiveSource` | 当前采用单价及来源 `model` / `rule` / null |
| `totalPriceYuan` | 采用单价乘真实单套面积，单位元；小区或缺面积时为 null |
| `priceRange` | 仅当采用模型时提供的参考区间，不是统计置信区间 |
| `modelEstimate` | 完整候选结果，包括候选单价、候选总价、区间、修正理由、证据 ID 和建议；待复核时也保留 |
| `buyerAdvice` / `disposalAdvice` / `summary` | 仅在采用模型结果时提升到顶层；待复核内容在 `modelEstimate` 中 |
| `evidence` / `knowledgeUsed` | 价格证据及采用的知识来源摘要 |
| `missingFields` / `warnings` / `reviewReasons` | 缺失信息、数据警告和复核原因 |
| `fallbackReason` | 模型不可用或校验失败等回退原因代码 |
| `dataQuality` / `baseline` | 有限样本的数据质量说明、公式构成 |
| `versions` / `generatedAt` | 模型、提示词、规则、知识、配置版本和生成时间 |

| `status` | 行为 |
|---|---|
| `model_estimate` | 结构和业务门槛通过，采用模型候选价格 |
| `needs_review` | 保留候选价和建议，采用价仍使用公式基准；没有基准则采用价为 null |
| `rule_only` | 模型未配置、被关闭、调用失败或输出不合格；明确使用公式参考价 |
| `insufficient_data` | 无有效估价，价格为 null，不能渲染成 0 元 |
| `processing` | 同一请求正在执行，不会再次调用模型 |
| `failed` | 数据/保存失败或执行租约过期；根据原因核实后用新的 requestId 重试 |

默认 `maxDeviationRatio=null`，所有模型候选价均需复核。只有由业务确认并配置偏离门槛、且候选结果不存在关键缺失/异常时，才会采用模型价格。此接口不提供人工审批动作。

真实模型联调成功应同时满足：真实模式返回 `needs_review` 或 `model_estimate`、`modelEstimate` 和有效 `modelUnitPrice` 非空、`fallbackReason=null`。默认配置下 `needs_review` 是有效的模型成功结果，候选价与建议保留供复核，采用价仍为公式基准。`rule_only` 仅表示回退流程完成，不能作为模型成功证据。随后还需核对前端展示与同一报告编号的 PDF 快照一致；具体操作见 [恢复真实联调](local-valuation-demo.md#恢复真实联调)。

## 模型 JSON 契约

模型必须仅返回以下字段，后端执行严格结构校验：

```json
{
  "unitPrice": 20000,
  "priceRange": { "low": 19000, "high": 21000 },
  "adjustments": [
    {
      "factor": "可比房源差异",
      "description": "使用输入证据解释价格判断，不能编造修正系数",
      "evidenceIds": ["输入中真实存在的证据 ID"]
    }
  ],
  "evidenceIds": ["输入中真实存在的价格证据 ID"],
  "buyerAdvice": "买方需要核实的事项与价格判断",
  "disposalAdvice": "卖方或银行处置意见，区分市场价与法拍处置条件",
  "missingFields": [],
  "summary": "估值依据与局限"
}
```

以上数字仅演示字段格式，不是实际估价。单价和区间必须为有限正数，`low <= unitPrice <= high`。必须引用至少一个真实房产价格证据，单独引用租金或知识条目不能通过。每项修正都必须引用已有证据。未知字段、空响应、截断或坏 JSON 不会当作成功估值。总价只由服务器计算。

## 查询和幂等

```js
const { result } = await wx.cloud.callFunction({
  name: 'aiChat',
  data: { action: 'getEvaluation', valuationId: 'createEvaluation 返回的编号' }
})
```

同一 OPENID 的同一 `requestId` 和相同参数会返回原报告，不再调用模型，即使配置或数据已经变化。相同 `requestId` 搭配不同参数返回 `REQUEST_ID_CONFLICT`。重新评估必须使用新的 `requestId`，并会保存新的输入快照；本期没有跨请求缓存。

并发请求通过确定主键原子插入去重。中断后保留 `processing` 租约，超期查询时返回 `failed/PROCESSING_EXPIRED`。这不是异步任务队列，不会在返回 ID 后继续启动后台任务。若后续确有长耗时需求，再引入可靠队列/触发器。

错误返回 `{ ok: false, code, error }`，例如 `UNAUTHORIZED`、`INVALID_REQUEST`、`TARGET_NOT_FOUND`、`COMMUNITY_MISMATCH`、`COMMUNITY_AMBIGUOUS`、`DATA_READ_FAILED`、`REPORT_WRITE_FAILED`、`CONFIG_INVALID`。原始供应商响应和密钥不会返回给调用方。

## 后台配置

`ai_config/main` 示例：

```json
{
  "provider": "deepseek",
  "model": "请填写实际可用且支持 JSON 模式的模型名称",
  "temperature": 0.2,
  "maxTokens": 2500,
  "requestBudgetMs": 25000,
  "maxDeviationRatio": null,
  "enabled": true,
  "businessInstructions": "重点说明近期成交依据和交付条件，未知事项列为待核实。",
  "configVersion": "valuation-config-v1"
}
```

温度允许 0–1，输出 token 预算 256–8000，请求预算 1000–45000 毫秒，偏离门槛为 null 或 0–1 的比例。`rules` 目前只接受空对象，基准规则版本为代码中的 `baseline-v1`，避免未经实现的价格参数被静默忽略。旧 `system_prompt/style_rules` 仍供旧解读接口使用，不约束新 JSON 接口。

`businessInstructions` 作为低优先业务参考，不能覆盖输出结构、证据校验和价格语义。供应商地址由服务端适配器固定，配置中不读取任意 base URL。

知识示例：

```json
{
  "enabled": true,
  "city": "珠海",
  "propertyType": "住宅",
  "topic": "市场比较",
  "title": "内部评估参考",
  "content": "由业务人员整理并核实的具体知识内容",
  "source": "资料名称",
  "sourceUrl": "https://example.com/source",
  "effectiveFrom": "2026-11-01",
  "effectiveTo": "2026-12-31",
  "version": "v1"
}
```

上述来源链接是格式占位，不是实际依据。知识先按城市/全国/缺省城市检索，再筛物业类型、有效期和相关性。日期只有年月日时按北京时间整天解释。正文有长度和总预算限制，未注明来源的知识会产生警告。

## 数据口径和当前限制

- `houses` 的真实成交必须同时有明确成交状态和 `deal_unit_price` / 实际成交金额；不会把普通 `unit_price`、起拍价或公告评估价当成交价。
- 兼容 `communities.deals.recent` 和 `communities.price.dealRecords` 的明确成交数组；同日、面积和单价相同的重复记录去重。
- 兼容现有万元总价字段与 Extended JSON 数值。规范输出一律使用元、元/㎡和㎡。没有单位的旧 `total_price` 按万元解释；新字段推荐显式使用 `_yuan`。
- 排除目标自身作为比较实例；排除未来日期证据；明确物业类型冲突的样本不混用。有限样本按类别和日期截取，并返回警告，不等于完整市场数据。
- 现有公式迁移为参考基准，没有宣称已验证估价精度；本期不是完成的银行自动审批或定价系统。
- 结构校验和偏离检查无法证明模型的所有判断都正确，仍需用已评估案例回测及业务复核。未知房产属性不会由模型补写到数据库。

## 本地验证

```bash
npm --prefix cloudfunctions/aiChat test
```

测试使用内存数据库和模拟模型响应，不读取真实密钥、不访问云数据库、不产生模型费用。覆盖数据归一、公式基准、知识过滤、JSON 协议、超时、证据/价格校验、报告保存、调用者隔离、并发幂等、失败回退和旧接口路由。这些测试本身不覆盖云端数据库索引、SDK、模型账号和网络行为；当前环境的真实验证结果记录如下，更换环境后需重新联调。

JSON 模式依据：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。

## 2026-11-18 真实联调记录

已通过官方开发工具 CLI 上传扁平部署包，并从微信模拟器完成真实 `createEvaluation` 调用与 PDF 导出。入口已兼容平台附加的 `userInfo`、`tcbContext`，调用身份仍由 WXContext 提供。本次结果使用真实数据库、云函数环境变量中的密钥和 `deepseek-chat`，没有切换到演示响应。

同一调用者通过 `getEvaluation` 成功读回已保存报告。小程序客户端直接读取 `valuation_reports` 被拒绝，返回 `-502003`；报告读取继续通过云函数执行调用者校验。

本次测试使用真实二手房，返回 `needs_review`、`effectiveSource=rule` 和 `fallbackReason=null`。报告包含模型候选价、公式采用价、36 条价格证据及 5 条知识，PDF 的数据模式为“云端评估结果”。候选总价直接取 `modelEstimate.totalPriceYuan`，候选价及意见标注待复核。价格明细在一页内放得下时整体排版，避免单条复核事项独占续页。

最终重导出复用了已保存的报告。18 页逐页核对了候选和采用总价、证据、知识及报告编号。相关 PDF 测试 10 项通过，最终全量测试 131 项通过。真实报告和调试快照留存在联调工作区。

这次联调验证了部署、真实模型结构化输出、报告保存及前端/PDF 链路，不代表估价精度或业务验收通过，也没有自动采纳模型候选价。复核阈值尚未校准，房源总楼层、装修等信息待核实；所检索的 5 条知识仍缺来源及明确版本，报告已保留相应警告，后续应由业务补齐并用已评估案例回测。
