import { tool } from 'ai'
import { canvasAgentToolSchemas as schema } from './tool-schemas'

// Do not attach execute handlers. Only the authenticated editor can apply
// tool calls, using its existing permission, confirmation and save paths.
export const canvasAgentTools = {
  find_nodes: tool({ inputSchema: schema.find_nodes, description: '查找画布节点。支持标题、正文和提示词筛选；拿到明确的节点引用后再改动。' }),
  read_node: tool({ inputSchema: schema.read_node, description: '读取一个节点的详情和邻接连线；不会返回素材链接或完整生成历史。' }),
  list_models: tool({ inputSchema: schema.list_models, description: '列出可用的画布内容生成模型；不能用来切换当前对话模型。' }),
  quote: tool({ inputSchema: schema.quote, description: '估算某个节点的生成消耗；只报价，不提交生成或修改画布。' }),
  build_graph: tool({ inputSchema: schema.build_graph, description: '搭建新的节点与连线；超过 6 个节点时给用户预览和确认。不要用蓝图覆盖已有作品。' }),
  update_nodes: tool({ inputSchema: schema.update_nodes, description: '修改已定位节点的标题、正文、提示词或生成选项。不要修改生成中的节点。' }),
  connect_nodes: tool({ inputSchema: schema.connect_nodes, description: '从来源节点向目标节点添加连线；不要创建重复线路。' }),
  disconnect_nodes: tool({ inputSchema: schema.disconnect_nodes, description: '断开明确指定的连线；不会删除节点或素材。' }),
  delete_nodes: tool({ inputSchema: schema.delete_nodes, description: '只有用户明确要求删除节点时才调用；含媒体或多于 3 个节点时需要确认。不会删除素材库文件。' }),
  arrange: tool({ inputSchema: schema.arrange, description: '整理全画布、指定节点或一个组中的布局；不会改变拓扑或节点正文。' }),
  group_nodes: tool({ inputSchema: schema.group_nodes, description: '把至少两个指定节点归为一个组；不复制、不删除已有节点。' }),
  set_canvas_prompt: tool({ inputSchema: schema.set_canvas_prompt, description: '设置或清除全局风格或视频前置提示词，不改写每个节点自己的提示词。' }),
  add_to_playlist: tool({ inputSchema: schema.add_to_playlist, description: '把已有视频加入指定播放列表。不要将生成中的节点当成已完成视频。' }),
  focus: tool({ inputSchema: schema.focus, description: '定位到指定节点，或显示全图；可选择指定节点，不改变内容。' }),
  generate: tool({ inputSchema: schema.generate, description: '提交指定节点的内容生成。消耗与权限由现有画布流程判断；未获确认时不能绕过限制。' }),
  open_tool: tool({ inputSchema: schema.open_tool, description: '打开节点已支持的工具或预览窗口，不代替用户在弹窗里确认操作。' }),
  cancel_generation: tool({ inputSchema: schema.cancel_generation, description: '取消用户要求停止的指定节点生成，不能撤回已完成结果。' }),
  ask_user: tool({ inputSchema: schema.ask_user, description: '重大选择或信息不足时，向用户提出一个问题和 2–4 个简短选项；不要自行代答。' }),
} as const
