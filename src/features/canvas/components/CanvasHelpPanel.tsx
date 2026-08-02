'use client'

import { Keyboard, Mouse, Move, X, ZoomIn } from '@/components/ui/icons'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

const sections = [
  { title: '创作', icon: Keyboard, rows: [['复制', `${mod} C`], ['剪切', `${mod} X`], ['粘贴', `${mod} V`], ['原地复制', `${mod} D`], ['拖拽复制', `${isMac ? '⌥' : 'Alt'} + 拖动`], ['移动节点', '方向键 5px'], ['快速移动', '⇧ + 方向键 50px'], ['框选节点', '触及主体；组内空白也可起框'], ['框选连线', '空白处拖框穿过连线'], ['追加框选', `⇧ / ${mod} + 拖框`], ['删除选中连线', isMac ? '⌫' : 'Del'], ['连接节点', '靠近端口自动吸附'], ['全选', `${mod} A`], ['保存', `${mod} S`]] },
  { title: '缩放', icon: ZoomIn, rows: [['放大', `${mod} +`], ['缩小', `${mod} −`], ['重置视图', `${mod} 0`], ['触控板', '双指捏合'], ['鼠标滚轮', `${mod} + 滚轮`]] },
  { title: '移动画布', icon: Move, rows: [['空格拖动', 'Space + 左键拖动'], ['触控板', '双指平移'], ['鼠标', '中键 / 右键拖动'], ['滚轮', '滚轮平移']] },
  { title: '其他', icon: Mouse, rows: [['撤销', `${mod} Z`], ['重做', `${mod} ⇧ Z / ${mod} Y`], ['删除', isMac ? '⌫' : 'Del'], ['小地图', 'M'], ['帮助', '?'], ['取消选中', 'Esc']] },
]

export function CanvasHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="nori-canvas-help-panel">
      <header><span><Keyboard />快捷键</span><button type="button" title="关闭" onClick={onClose}><X /></button></header>
      <div>
        {sections.map(({ title, icon: Icon, rows }) => <section key={title}><h3><i><Icon /></i>{title}</h3><ul>{rows.map(([label, shortcut]) => <li key={label}><span>{label}</span><kbd>{shortcut}</kbd></li>)}</ul></section>)}
      </div>
    </aside>
  )
}
