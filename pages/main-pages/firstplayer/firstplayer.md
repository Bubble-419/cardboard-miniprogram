实现一个页面：上帝用户在该页手动选择首位出牌玩家并可长按拖动调整玩家顺序。系统/后台不会自动决定首位玩家；只有用户点选后才高亮，并且未选择时底部按钮为灰色禁用。
页面结构（UI）玩家在selectPlayer阶段可以选择跳过，或者达到最大人数抽取到一位玩家后自动跳转firstplayer页面

顶部导航栏

左：返回--返回是返回到selectPlayer页面

中：标题 确认首位出牌玩家


主内容（环形玩家布局）

一个外圆环轨道（绿色描边）。

玩家头像沿圆环均匀分布（最多支持 6人，同时在一个房间的玩家人数有几人就是几个玩家）。

头像默认灰色圆形填充标注玩家名称 + 绿色描边。

选中态：被单击选中的玩家头像高亮（描边加粗/放大/阴影其一即可）。

提示文案（绿色居中）

选择首位出牌玩家

底部主按钮

文案：开始脑暴

disabled 条件：当 selectedFirstPlayerId == null 时置灰且不可点击。

enabled：绿色可点击。\
1) 单击选择玩家

触发条件：tap/click 某个头像

行为：

selectedFirstPlayerId = tappedPlayer.id

UI：该玩家头像进入高亮态；其他恢复默认态

底部按钮从 disabled → enabled

注意：不从后台/系统自动获取首位玩家，也不做随机抽选。

2) 长按拖动切换排序

触发条件：long press 某个头像进入拖拽模式（建议长按 300~500ms）

拖拽行为：

- 进入拖拽模式时：当前被长按的头像立即移动到手指位置，透明度为 80%，同时略微放大；其他头像保持在原来的圆环槽位上。
- 拖动过程中：
  - 被拖拽头像始终跟随手指移动（x = 当前手指横坐标，y = 当前手指纵坐标）。
  - 其他头像始终停留在各自的圆环槽位位置，不发生“突然跳动”。
  - 在拖拽过程中不做实时换位，只做位置预览（避免轻微移动就触发顺序突变）。

顺序交换（reorder）：

- 松手时，根据拖拽结束时手指位置计算距离最近的槽位 nearestIndex：
  - 若 nearestIndex != 当前被拖拽头像所在的索引 draggingIndex：
    - 对 players 做一次 reorder（将 dragging item 移动到 nearestIndex）。
    - 更新 draggingIndex。
- 松手后：
  - players 数组顺序被更新。
  - 头像重新按照新顺序在圆环上均匀布局（带过渡动画更好）。

约束：

- 拖拽不应触发“单击选择”（避免误触）：进入拖拽模式后取消 tap 事件。
- 允许拖拽时仍保留当前 selectedFirstPlayerId（若被拖动的是选中玩家，选中态跟随它的新位置）。

3) 底部按钮点击

仅在 selectedFirstPlayerId != null 时可点击

点击后回调：

onConfirmFirstPlayer(selectedFirstPlayerId, playersOrder)

playersOrder 建议传 players.map(p=>p.id)（用于后续出牌顺序）

圆形布局（Layout Algorithm）

将 players 按当前数组顺序均匀放置在圆周上（以屏幕可视区域的几何中心为参考点）：

angle = startAngle + index * (2π / N)

y = centerY + radius * sin(angle)

- 坐标系统说明：
  - 以屏幕像素坐标为基础，从系统 `windowWidth` / `windowHeight` 计算出适配当前设备的缩放比例 scale = 750 / windowWidth。
  - 圆心纵坐标 `centerY` 使用屏幕高度（转换为 rpx）的一半，即视觉上位于可视区域的几何中心，确保圆心与手指坐标在同一坐标系下对齐。
  - 手指拖拽时，以“小圆头像的圆心”为基准，将手指的像素坐标乘以 scale 得到 rpx 坐标，直接赋值给头像圆心的 x/y，使头像圆心始终紧贴手指位置。

x = centerX + radius * cos(angle)

y = centerY + radius * sin(angle)

startAngle = -π/2（第 0 个在正上方）

头像使用 absolute positioning 放置到 (x, y)

拖拽排序实现要点（Reorder Logic）

每个玩家有一个目标槽位（slot index = 在 players 数组中的 index）

拖拽中计算当前拖动头像与各槽位中心点距离：

找到距离最近的槽位 nearestIndex

若 nearestIndex != draggingIndex：

对 players 做 reorder（将 dragging item 移动到 nearestIndex）

更新 draggingIndex

松手时：

拖动头像吸附到其最终槽位坐标（动画）

视觉/状态细节（UX）

disabled 按钮：

背景灰、文字浅灰、不可点（pointerEvents 禁止）

选中态：

头像 scale 1.1~1.2

描边加粗或加阴影（任选）

拖拽态：

dragged avatar 提升层级（zIndex）

可加轻微阴影或缩放

过渡动画：

reorder 后其他头像平滑移动到新位置（150~250ms）