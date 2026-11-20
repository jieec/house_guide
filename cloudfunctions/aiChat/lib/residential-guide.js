function usesResidentialGuide(target) {
  if (!target || target.type !== 'house' || typeof target.propertyType !== 'string') return false
  return /^(?:普通商品|普通|商品|成套|多层|小高层|中高层|高层)?住宅$/.test(target.propertyType.trim())
}

// Adapted from the supplied residential comparison parameter table. Keep the
// conditions together so a number cannot be reused without its evidence gate.
const RESIDENTIAL_ADJUSTMENT_GUIDE = [
  '住宅市场比较修正参数（通用参考，须结合本地成交校准）',
  '先选同区位、用途相同、成交日期接近的普通住宅实际成交。仅对有 comparisonAttributes 的 sale_deal 计算系数；挂牌、法拍及汇总只作独立参考。双方属性明确且在表内才修正，缺失或范围外列入 missingFields；不能猜取值、凑足九项或把日期差直接换算成涨跌幅。',
  '同一可比实例的修正单价＝实际成交单价×各独立项（目标系数÷实例系数）的乘积。同条件比值为1，目标条件较优时上调实例单价，较差时下调。楼层附加条件并入楼层项，避免重复计价。结合多笔修正后单价和市场证据给候选价，公式基准仍供对照。',
  '楼层：须有明确所在层和总层数。总层数1–7的系数按从低到高依次为 1:[100]，2:[100,100]，3:[99,100,98]，4:[98,99,100,98]，5:[98,99,100,100,98]，6:[98,99,100,100,99,97]，7:[98,99,100,100,99,98,97]。仅在条件证实后调整：坡屋面顶层+1%，带地下室的一层+1%/顶层−1%，有电梯从第3层起每层累加0.5%，一层专属院落+1%。总层数n≥8时，1–6层分别97.5/98/98.5/99/99.5/100，第7至n−1层为100+(层−6)×0.2，顶层为100+(n−6)×0.2−1。仅写高/中/低层时无法查表。',
  '朝向：北/西/东/南为97/98/99/100，须有明确主朝向。面积：<90㎡为100，90–143㎡为99，144–200㎡为98。结构：砖木/砖混/钢筋混凝土为98/100/102。装修：毛坯/普通/精装/豪装为97/100/103/106。',
  '楼龄、物业管理、噪声、布局使用相对法，目标项固定100。实例楼龄系数为100+(实例建成年−目标建成年)÷3，即实例每旧3年减1分；物业无/一般/较完善/完善每优一档+2分、劣一档−2分；临街不安静→不临街安静每优一档+2分；布局不合理→合理每优一档+1分。噪声和布局较差时反向减分，同档100。不叠加绝对档位分数。',
  '在 adjustments.description 写双方条件、所用系数及修正方向，evidenceIds 引用对应成交条目。表本身是方法参数，不是实际成交证据。'
].join('\n')

module.exports = { usesResidentialGuide, RESIDENTIAL_ADJUSTMENT_GUIDE }
