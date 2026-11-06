/**
 * dsh-tang-agent · 图形素材
 * 印章与六部字符均为本插件原创绘制，不依赖外部字体或图片。
 */

export const TDA_GLYPHS = {
  works: '工',
  justice: '刑',
  war: '兵',
  rites: '礼',
  revenue: '户',
  personnel: '吏',
};

/**
 * 唐印：外方内方，中刻“唐”字。
 * mono=true 时随 currentColor（用于侧边栏图标）；否则使用朱砂色。
 */
export function TangSeal(props) {
  const options = props || {};
  const size = options.size || 44;
  const mono = Boolean(options.mono);
  const stroke = mono ? 'currentColor' : 'var(--tda-seal)';
  const fill = mono ? 'none' : 'var(--tda-seal)';
  const text = mono ? 'currentColor' : '#f7efe2';
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 48 48',
      'aria-hidden': 'true',
      style: { display: 'block', flex: 'none' },
    },
    h('rect', {
      x: 3.2,
      y: 3.2,
      width: 41.6,
      height: 41.6,
      rx: 6,
      fill,
      stroke,
      strokeWidth: 2.4,
    }),
    h('rect', {
      x: 8.4,
      y: 8.4,
      width: 31.2,
      height: 31.2,
      rx: 3.2,
      fill: 'none',
      stroke: text,
      strokeOpacity: mono ? 0.45 : 0.6,
      strokeWidth: 1,
    }),
    h(
      'text',
      {
        x: 24,
        y: 25.4,
        textAnchor: 'middle',
        dominantBaseline: 'central',
        fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif',
        fontSize: 20,
        fontWeight: 700,
        fill: text,
      },
      '唐',
    ),
  );
}

/** 六部字符印。 */
export function MinistryGlyph(props) {
  const options = props || {};
  const id = options.id || 'works';
  return h('span', { className: 'tda-glyph', 'aria-hidden': 'true' }, TDA_GLYPHS[id] || '部');
}
