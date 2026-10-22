#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re
import os
from pathlib import Path

# 收集所有中文字符
chinese_chars = set()

# 搜索所有文本文件
for root, dirs, files in os.walk('.'):
    # 跳过 node_modules 等
    dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', 'fonts', '.wechatide']]
    
    for file in files:
        if file.endswith(('.wxml', '.js', '.wxss', '.json')):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    # 提取中文字符 (CJK Unicode 范围)
                    matches = re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df\u2a700-\u2b73f\u2b740-\u2b81f\u2b820-\u2ceaf\uf900-\ufaff]', content)
                    chinese_chars.update(matches)
            except:
                pass

# 添加常用字符确保完整性
common = '快捷工具房产评估看清价值查看报告基本信息房源分析位置价值评估金融贷款税费风险分析抵押贷款契税增值税个税结论报告用户设置账户管理退出登录首页房源列表详情社区分析房屋估价房价走势周边配套交通出行学校医院餐饮购物娱乐生活服务确认取消返回搜索添加删除编辑保存加载中请稍候失败成功操作完成确定提示警告错误信息提醒关于帮助反馈建议支持版本更新下载安装卸载分享收藏标记评分评论点赞赞同反对举报投诉申请申述审核审批批准拒绝待处理处理中已完成已取消已过期。，；：！？…—·""''（）【】《》、·～'
common_chars = re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', common)
chinese_chars.update(common_chars)

# 排序
sorted_chars = ''.join(sorted(chinese_chars))
print(f"Total Chinese characters needed: {len(chinese_chars)}")
# print(f"First 100: {sorted_chars[:100]}")

# 保存到文件
with open('chinese_chars.txt', 'w', encoding='utf-8') as f:
    f.write(sorted_chars)
    
with open('chinese_chars_count.txt', 'w', encoding='utf-8') as f:
    f.write(f"{len(sorted_chars)}\n")
    f.write(sorted_chars)

print(f"\nOK - saved {len(sorted_chars)} chars to chinese_chars.txt")
