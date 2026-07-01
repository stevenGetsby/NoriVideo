/**
 * Demo data mirroring the captured FrameOS "TEST" project, used as a fallback
 * when the backend has no real episodes/assets yet. Sourced from
 * .runtime/frameos-frontend-handoff captures.
 */
import type { FosEpisode, FosAsset, FosAssetVariant } from './useFosProject'

const EPISODE_TITLES: Array<[number, string, number]> = [
  [1, '雨夜出逃', 680], [2, '土地庙相遇', 606], [3, '被迫为妾', 657], [4, '入府受辱', 702],
  [5, '暗夜送饭', 756], [6, '栽赃反击', 684], [7, '书房告状', 794], [8, '身孕揭晓', 495],
  [9, '堕胎阴谋', 670], [10, '暗夜绑人', 574], [11, '阿婆失踪', 834], [12, '主动上位', 659],
  [13, '粥暖人心', 709], [14, '阿婆之死', 769], [15, '收集罪证', 917], [16, '当众揭穿', 600],
  [17, '沈氏伏法', 661], [18, '喜得贵子', 648], [19, '督军府暗斗', 730], [20, '恶霸伏法', 546],
  [21, '宴会反击', 543], [22, '军中谣言', 568], [23, '情报网布网', 589], [24, '再次怀孕遇险', 608],
  [25, '督军病危', 598], [26, '叛乱爆发', 448], [27, '平叛就任', 601], [28, '厚葬阿婆', 444],
  [29, '共治省城', 486], [30, '圆满落幕', 477],
]

const E1_TEXT = `第一集
1-1
场景：破旧柴房 - 夜 - 雨
人物：我（苏晚卿）、张秃子
镜头特写：我猛地从混沌中惊醒，脑袋昏沉、浑身酸软，额头冷汗浸透衣衫，手臂淤青刺痛，眼底满是惊恐与屈辱。我忽然想起，娘骗我喝下汤药后，我便浑身无力，原来她卖我时，还怕我反抗下了药。
△柴房昏暗潮湿，油灯摇曳，张秃子赤裸上身，带着浓重酒气，满脸狞笑地向我逼近。药效未退，我浑身发软，只能徒劳后缩。
张秃子（粗哑狞笑，抓我手腕）：小美人，你娘把你卖给我还下了药，从今往后你就是我的人！
我（缩手蜷身，声音发颤却藏狠劲）：放开我！我娘卖我不算数，就算死，我也不伺候你这个恶魔！
△张秃子怒极扬手，我趁机摸出发髻里陈阿婆留的银簪，攥紧当作武器。张秃子扑来，我侧身躲开，狠狠将银簪刺向他手臂。
张秃子（惨叫嘶吼）：贱人！给我抓住她，别让她跑了！
△我拔下银簪，不顾手心划伤，跌跌撞撞拉开木门，冲进瓢泼大雨。冰冷雨水浇醒几分混沌，我回头瞪着追来的张秃子，嘶吼着冲进雨幕，身后追兵的嘶吼声紧追不舍。
1-2
场景：城郊土地庙 - 夜 - 雨
人物：我（苏晚卿）、追兵
镜头切换：我跑得气喘吁吁，脸色惨白、嘴唇发紫，药效带来的无力感让我眼前发黑，不慎摔进泥水，挣扎着爬起，踉跄冲进前方破旧土地庙。
△我靠在冷墙上喘气，浑身发抖，死死攥着银簪，手心伤口渗血。眼泪混着雨水滑落。
我（低声呢喃）：阿婆，我不能死，我还要回去找你……
△庙外追兵脚步声、呼喊声渐近，火把光亮映进窗棂。追兵嘶吼："苏晚卿，快出来！不然放火烧庙！"`

export const demoEpisodes: FosEpisode[] = EPISODE_TITLES.map(([n, name, words]) => ({
  id: `demo-e${n}`,
  episodeNumber: n,
  name,
  novelText: n === 1 ? E1_TEXT : null,
  wordCount: words,
}))

function asset(id: string, name: string, type: string, description: string, prompt: string, extra?: { episodes?: string; variants?: FosAssetVariant[] }): FosAsset {
  return { id, name, type, description, prompt, imageUrl: null, confirmed: true, episodes: extra?.episodes ?? null, variants: extra?.variants }
}

export const demoCharacters: FosAsset[] = [
  asset('c1', '苏晚卿', '主角', '工农底层出身，后期成为豪门顶层督军夫人，正派主视角。性格外柔内刚、隐忍果决，被生母卖给恶霸张秃子后逃亡，被陆承煜所救入陆府，为养母陈阿婆复仇，与陆承煜并肩平定叛乱，成为督军夫人。原文别名：我、苏姨太、侧夫人、督军夫人。', '【整体美学】真人实拍摄影质感，自然皮肤毛孔与织物纹理，影棚级光影，35mm 胶片质地。\n\n【画面规格】角色设定图，"苏晚卿"。16:9 横版，纯白背景，平视视角。仅一个角色，画面中不得出现其他人物。', {
    episodes: 'EP12–18 · 共7集',
    variants: [
      { label: '孤女逃亡时期', episodes: 'EP1–3 · 共3集', description: '相对主形象，服装换为靛蓝色粗布大襟短衫、黑色粗布长裤、黑布千层底布鞋，浑身湿透沾泥水，手臂有淤青，发型凌乱，面色惨白唇色发紫，其余外观特征保持不变。' },
      { label: '陆府姨太时期', episodes: 'EP4–11 · 共8集', description: '相对主形象，服装换为藏青色粗棉布旗袍、黑布平跟鞋，服饰半旧有磨损，无贵重配饰，藏令牌与银簪，面色怯懦警惕，其余外观特征保持不变。' },
      { label: '督军夫人时期', episodes: 'EP12–18 · 共7集', description: '相对主形象，服装换为月白色提花真丝旗袍、缎面高跟绣鞋，佩戴鎏金点翠首饰，妆容精致，神态雍容沉静，其余外观特征保持不变。' },
      { label: '老年时期', episodes: 'EP19–30 · 共12集', description: '相对主形象，发色斑白挽髻、面有岁月纹理，着深绛色素缎旗袍、外罩深色绒披肩，神态慈和坚毅，其余外观特征保持不变。' },
    ],
  }),
  asset('c2', '陆承煜', '核心配角', '督军府嫡长子，外冷内热，救下逃亡的苏晚卿并娶为侧室，与其并肩平定叛乱。', '真人实拍质感，民国军装与便装两套，冷峻克制气质，纯白背景三视图。', {
    episodes: 'EP4–18 · 共15集',
    variants: [
      { label: '便装时期', episodes: 'EP4–11 · 共8集', description: '相对主形象，服装换为深灰色长衫、黑布鞋，气质温润内敛，其余外观特征保持不变。' },
      { label: '老年时期', episodes: 'EP19–30 · 共12集', description: '相对主形象，鬓角染霜、面有刚毅纹理，着深色立领军常服，威严沉稳，其余外观特征保持不变。' },
    ],
  }),
  asset('c3', '沈曼柔', '核心配角', '陆府正室出身名门，表面温婉实则善妒阴狠，多次构陷苏晚卿。', '真人实拍质感，民国名门贵妇旗袍，精致妆容下藏阴鸷神态。'),
  asset('c4', '柳氏', '核心配角', '陆督军侧室，左右逢源，立场摇摆。', '真人实拍质感，民国姨太装扮。'),
  asset('c5', '陆承宇', '核心配角', '陆府次子，纨绔却重情义。', '真人实拍质感，民国公子哥装扮。'),
  asset('c6', '张秃子', '核心配角', '底层恶霸，买下苏晚卿，第一集被刺伤逃脱。', '真人实拍质感，民国底层恶霸，光头络腮胡，粗粝凶相。'),
  asset('c7', '陆督军', '核心配角', '一省督军，陆承煜之父，威严多疑。', '真人实拍质感，民国督军军礼服，威严持重。'),
  asset('c8', '陈阿婆', '配角', '苏晚卿的养母，留下银簪与信物，后被害身亡。', '真人实拍质感，民国底层老妪，慈和坚毅。'),
  asset('c9', '王媒婆', '配角', '牵线人，市井圆滑。', '真人实拍质感，民国媒婆装扮。'),
  asset('c10', '春桃', '配角', '苏晚卿心腹丫鬟，忠心机敏。', '真人实拍质感，民国丫鬟装扮。'),
]

export const demoItems: FosAsset[] = [
  asset('i1', '陈阿婆留的银簪', '核心道具', '主使用者：苏晚卿。陈阿婆留给苏晚卿的遗物，是苏晚卿最初的防身武器与贯穿全剧的情感信物，第一集刺张秃子、多集用于防身。', '黑色氧化银簪，民国旧物，表面有细小划痕和陈旧包浆，局部雕花，簪尾有轻微变形。微距产品摄影，纯净背景，单物体展示。'),
  asset('i2', '刻"陆"字玄铁令牌', '核心道具', '陆府身份信物，关键时刻证明身份。', '玄铁令牌，正面阴刻"陆"字，边缘磨损，微距产品摄影。'),
  asset('i3', '羊脂玉镯', '道具', '定情信物。', '羊脂白玉镯，温润通透，微距产品摄影。'),
  asset('i4', '督军夫人专属凤钗', '道具', '督军夫人身份象征。', '鎏金点翠凤钗，工艺繁复，微距产品摄影。'),
  asset('i5', '沈曼柔栽赃用玉簪', '道具', '构陷苏晚卿的关键物证。', '青玉簪，雕花精致，微距产品摄影。'),
]

export const demoEnvironments: FosAsset[] = [
  asset('v1', '张秃子家破旧柴房', '室内空间', '建筑等级：民国底层农家柴房档；是苏晚卿被生母出卖后囚禁的初始场所，也是她雨夜出逃、反抗命运的起点，氛围压抑绝望。', '民国时期破旧柴房，低矮木梁、潮湿木材、泥土地面、墙面剥落，昏暗油灯与雨夜冷光从缝隙打入。'),
  asset('v2', '城郊破旧土地庙', '室内空间', '苏晚卿雨夜逃亡的暂避之所，破败神像，与陆承煜相遇的地点。', '民国城郊破旧土地庙，破败神像，蛛网灰尘，火把冷光，院线电影质感。'),
  asset('v3', '陆府偏僻小院', '室内空间', '苏晚卿入府后的居所，简朴清冷。', '民国陆府偏院，青砖灰瓦，陈设简朴，清冷光线。'),
  asset('v4', '陆府书房', '室内空间', '议事与对峙的核心场所。', '民国大户书房，红木家具，藏书满墙，暖黄灯光。'),
  asset('v5', '督军府大门', '室外空间', '权力象征的恢弘门庭。', '民国督军府大门，石狮门庭，军卫森严，恢弘冷峻。'),
]

/* ---------- storyboard success-state demo (mirrors live FrameOS E4 入府受辱) ---------- */
export type FosSegIntent = 'establish' | 'conflict' | 'emotion' | 'reverse'

export interface FosSegAssetRef { kind: '角色' | '物品' | '环境'; name: string }
export interface FosStorySegment {
  id: string
  intent: FosSegIntent
  intentLabel: string
  duration: number
  scriptHeading: string
  scriptText: string
  refs: FosSegAssetRef[]
}
export interface FosStoryScene {
  code: string
  location: string
  env: string
  segments: FosStorySegment[]
}
export interface FosStoryboardEpisode {
  episodeNumber: number
  sceneCount: number
  segmentCount: number
  totalSeconds: number
  scenes: FosStoryScene[]
}

const WITH_SHEN = (extra: string[] = []): FosSegAssetRef[] => [
  { kind: '角色', name: '苏晚卿 · 陆府姨太时期' },
  { kind: '角色', name: '沈曼柔' },
  { kind: '角色', name: '沈曼柔贴身丫鬟' },
  ...extra.map((name) => ({ kind: '物品' as const, name })),
  { kind: '环境', name: '陆府偏僻小院' },
]

export const demoStoryboard: FosStoryboardEpisode = {
  episodeNumber: 4,
  sceneCount: 1,
  segmentCount: 9,
  totalSeconds: 121,
  scenes: [
    {
      code: 'S01',
      location: '陆府偏僻小院',
      env: '日 - 阴',
      segments: [
        { id: 'S01-SEG01', intent: 'establish', intentLabel: '建立情境', duration: 10, scriptHeading: '第四集', scriptText: '第四集', refs: [{ kind: '角色', name: '苏晚卿 · 陆府姨太时期' }, { kind: '角色', name: '春桃' }, { kind: '物品', name: '刻"陆"字玄铁令牌' }, { kind: '环境', name: '陆府偏僻小院' }] },
        { id: 'S01-SEG02', intent: 'conflict', intentLabel: '制造冲突', duration: 12, scriptHeading: '春桃', scriptText: '春桃（刻薄甩下包袱）：乡野丫头，能住这里就不错了，别妄想攀高枝，惹恼沈姨太没好果子吃！', refs: [{ kind: '角色', name: '苏晚卿 · 陆府姨太时期' }, { kind: '角色', name: '春桃' }, { kind: '物品', name: '刻"陆"字玄铁令牌' }, { kind: '环境', name: '陆府偏僻小院' }] },
        { id: 'S01-SEG03', intent: 'emotion', intentLabel: '情绪承载', duration: 14, scriptHeading: '春桃', scriptText: '春桃（恼羞成怒，撞翻水杯泼我手背，冷笑）：敢嘴硬？偷懒就罚你一天不吃饭！（说完扬长而去。）', refs: [{ kind: '角色', name: '苏晚卿 · 陆府姨太时期' }, { kind: '角色', name: '春桃' }, { kind: '物品', name: '刻"陆"字玄铁令牌' }, { kind: '环境', name: '陆府偏僻小院' }] },
        { id: 'S01-SEG04', intent: 'conflict', intentLabel: '制造冲突', duration: 15, scriptHeading: '沈曼柔', scriptText: '沈曼柔（带着丫鬟闯入，神色傲慢、语气尖酸）：苏晚卿？乡下来的贱丫头，住这破地方正合适。', refs: WITH_SHEN() },
        { id: 'S01-SEG05', intent: 'conflict', intentLabel: '制造冲突', duration: 12, scriptHeading: '沈曼柔', scriptText: '沈曼柔（揪住我的头发，厉声呵斥）：卑贱孤女也配说自重？敢抢我位置，活腻歪了！', refs: WITH_SHEN() },
        { id: 'S01-SEG06', intent: 'conflict', intentLabel: '制造冲突', duration: 14, scriptHeading: '沈曼柔', scriptText: '沈曼柔（扇我一耳光，踹我跪倒在地）：在陆府我说了算，你也敢反抗？', refs: WITH_SHEN() },
        { id: 'S01-SEG07', intent: 'conflict', intentLabel: '制造冲突', duration: 15, scriptHeading: '沈曼柔', scriptText: '沈曼柔（扫落衣物，我的令牌滑落，她狠狠踩在脚下碾动）：拼命？你也配？我毁了这破牌子，让你断了念想！', refs: WITH_SHEN(['刻"陆"字玄铁令牌 · 踩压变形态']) },
        { id: 'S01-SEG08', intent: 'conflict', intentLabel: '制造冲突', duration: 15, scriptHeading: '沈曼柔', scriptText: '沈曼柔（捏住我下巴，狠厉威胁）：记住你的身份！敢踏出小院一步，我打断你的腿，再杀了陈阿婆！', refs: WITH_SHEN(['刻"陆"字玄铁令牌 · 踩压变形态']) },
        { id: 'S01-SEG09', intent: 'reverse', intentLabel: '反转钩子', duration: 14, scriptHeading: '内心OS', scriptText: '△沈曼柔转身离去，我捡起变形的令牌，望着她的背影，心底暗誓。（内心OS）：沈曼柔，今日之辱，我必加倍奉还！', refs: WITH_SHEN(['刻"陆"字玄铁令牌 · 踩压变形态']) },
      ],
    },
  ],
}
