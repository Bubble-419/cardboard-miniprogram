/**
 * partner-avatar — 合伙人模式头像框组件
 *
 * 属性说明：
 *   src          头像图片 URL；为空时显示默认头像
 *   type         外框状态
 *                  'normal'          普通（无出牌轮次）
 *                  'active-nonaction' 行动中&&非行动页（是当前出牌玩家，但本页面不是出牌页）
 *                  'active'          行动中（出牌页，正在轮到该玩家出牌）
 *   isSelf       是否独立查看（true = 当前登录用户自己的头像，显示更强的高亮）
 *   showArrow    是否显示下方的向上三角指示箭头（▲）
 */
Component({
  properties: {
    src: {
      type: String,
      value: ''
    },
    type: {
      type: String,
      value: 'normal'
    },
    isSelf: {
      type: Boolean,
      value: false
    },
    showArrow: {
      type: Boolean,
      value: false
    },
    size: {
      type: String,
      value: 'md'
    }
  },

  data: {
    defaultSrc: '/assets/avatar/frame_2085662311_1x.webp'
  }
});
