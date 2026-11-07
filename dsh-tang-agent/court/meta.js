/** 三部六部共享元数据；Host 与 Client 构建共用同一份。 */

export const MINISTRY_ORDER = ['works', 'justice', 'war', 'rites', 'revenue', 'personnel'];

export const MINISTRIES = {
  works: { id: 'works', name: '工部', en: 'Works', glyph: '工', duty: '营造、工程、器物、代码与交付物', toolLabel: '文件读写' },
  justice: { id: 'justice', name: '刑部', en: 'Justice', glyph: '刑', duty: '律令、合规、静态扫描与风险审查', toolLabel: '代码扫描' },
  war: { id: 'war', name: '兵部', en: 'War', glyph: '兵', duty: '调度、终端执行、排期与应急', toolLabel: '终端命令' },
  rites: { id: 'rites', name: '礼部', en: 'Rites', glyph: '礼', duty: '文告、文档、仪注与对外沟通', toolLabel: '文档读取' },
  revenue: { id: 'revenue', name: '户部', en: 'Revenue', glyph: '户', duty: '钱粮、预算、字符与 Token 统计', toolLabel: '字数统计' },
  personnel: { id: 'personnel', name: '吏部', en: 'Personnel', glyph: '吏', duty: '人事、差遣、工具面与考成', toolLabel: '工具盘点' },
};

export const EXTRA_ROLES = {
  zhongshu: { id: 'zhongshu', name: '中书省', en: 'Zhongshu', glyph: '中', duty: '起草行动草案', toolLabel: '只读' },
  qintianjian: { id: 'qintianjian', name: '钦天监', en: 'Observatory', glyph: '天', duty: '核验当前 DSH 能力面与方案可行性', toolLabel: '能力探测' },
  menxia: { id: 'menxia', name: '门下省', en: 'Menxia', glyph: '门', duty: '契约审议与封驳', toolLabel: '只读' },
  shangshu: { id: 'shangshu', name: '尚书省', en: 'Shangshu', glyph: '尚', duty: '派发、督办与汇总', toolLabel: '只读' },
};

export const ROLE_LABELS = {
  ...Object.fromEntries(Object.values(MINISTRIES).map((m) => [m.id, m.name])),
  ...Object.fromEntries(Object.values(EXTRA_ROLES).map((r) => [r.id, r.name])),
};

export const STAGE_LABELS = {
  idle: '静候圣旨',
  drafting: '中书起草',
  feasibility: '钦天监勘验',
  reviewing: '门下朱批',
  revising: '封还重拟',
  dispatching: '尚书下发',
  executing: '六部奉行',
  aggregating: '尚书汇总',
  completed: '六部覆命',
  escalated: '封还御前',
  cancelled: '已中止',
  failed: '运行失败',
  quick: '快速问答',
  single: '单部直调',
};

export const TOOL_MODE_LABELS = {
  full: '完整朝议',
  single: '单部直调',
  quick: '快速问答',
};
