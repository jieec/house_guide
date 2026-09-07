# 房产分析报告数据契约

“指南”页只要求用户选择位置和小区，其他内容均来自微信云数据库。

## communities 集合

每个小区建议至少包含：

- `province`、`city`、`district`、`community`
- `updatedAt`：本次爬取或聚合更新时间
- `base.propertyType`、`base.averageArea`、`base.completionTime`
- `base.developer`、`base.propertyCompany`、`base.plotRatio`、`base.greenRate`
- `base.areaRank`：区域公开排名或后台计算排名
- `price.price`：小区均价（元/㎡）
- `price.listingPrice`：平均挂牌价（元/㎡）
- `price.recentDealPrice`：近期真实成交均价（元/㎡）
- `price.auctionPrice`：法拍成交均价（元/㎡）
- `price.rentPerSqm`：平均租金（元/㎡/月）
- `price.evaluationPrice`：第三方评估价格（元/㎡）
- `price.averageTotalPrice`：平均总价（万元）
- `price.saleCount`：在售或成交样本数
- `price.history`：历史价格数组，例如 `[{ month: "2026-07", price: 28000 }]`
- `pois.subway`、`pois.bus`、`pois.school`、`pois.hospital`
- `nearComms`：周边竞品，例如 `[{ name, price, dist }]`

兼容旧字段：`ajk_avg_price`、`ajk_props`、`categories`、`priceHistory`、`history_prices`。

## houses 集合

每条房源建议至少包含：

- `city`、`district`、`community`、`category`
- `unit_price`、`total_price`、`area_sqm`
- 租房：`rent_month`
- 真实成交：`status: "成交"`，并提供 `deal_unit_price`
- 法拍：`category: "法拍房"`，以及 `source`、成交价和成交时间

挂牌房源只用于计算挂牌均价，不能作为近期真实成交价。

## policies 集合

- `city`：城市名或“全国”
- `summary`、`purchase_limit`、`tax`
- 建议同时保存 `updatedAt` 和来源链接

## 当前代码层面确认的缺口

现有查询逻辑不能证明云端具体记录是否完整；新指南会在用户选择小区后逐项审计，并在“工具使用 → 后台数据完整性”中显示缺失字段。

按原代码已使用的字段判断，最需要补齐和统一的是：城市均价、近期真实成交价、法拍成交价、历史价格序列、第三方评估价格、区域排名和数据更新时间。
