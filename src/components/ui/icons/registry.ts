import type { IconComponent } from './ph/createIcon'
import ArrowDownCircle from './ph/arrow-circle-down'
import ArrowRight from './ph/arrow-right'
import AudioLines from './ph/waveform'
import BadgeCheck from './ph/seal-check'
import BookOpen from './ph/book-open'
import Bookmark from './ph/bookmark-simple'
import Box from './ph/cube'
import Brain from './ph/brain'
import ChartColumn from './ph/chart-bar'
import Check from './ph/check'
import ChevronDown from './ph/caret-down'
import ChevronLeft from './ph/caret-left'
import ChevronRight from './ph/caret-right'
import ChevronUp from './ph/caret-up'
import CircleUser from './ph/user-circle'
import Clapperboard from './ph/film-slate'
import ClipboardCheck from './ph/clipboard-text'
import Clock3 from './ph/clock'
import Cloud from './ph/cloud'
import CloudOff from './ph/cloud-slash'
import CloudUpload from './ph/cloud-arrow-up'
import Coins from './ph/coins'
import Copy from './ph/copy'
import Cpu from './ph/cpu'
import Diamond from './ph/diamond'
import Download from './ph/download-simple'
import ExternalLink from './ph/arrow-square-out'
import Eye from './ph/eye'
import EyeOff from './ph/eye-slash'
import FileText from './ph/file-text'
import Film from './ph/film-strip'
import Filter from './ph/funnel-simple'
import Folder from './ph/folder-simple'
import FolderHeart from './ph/folder-simple-star'
import FolderOpen from './ph/folder-open'
import Globe from './ph/globe'
import GripVertical from './ph/dots-six-vertical'
import History from './ph/clock-counter-clockwise'
import Image from './ph/image'
import ImagePlus from './ph/image-square'
import Info from './ph/info'
import Lightbulb from './ph/lightbulb'
import Link2 from './ph/link-simple'
import Loader2 from './ph/circle-notch'
import Lock from './ph/lock-simple'
import LogOut from './ph/sign-out'
import Menu from './ph/list'
import Mic from './ph/microphone'
import Minus from './ph/minus'
import Monitor from './ph/monitor'
import Pause from './ph/pause'
import Pencil from './ph/pencil-simple'
import Play from './ph/play'
import PlayCircle from './ph/play-circle'
import Plus from './ph/plus'
import Receipt from './ph/receipt'
import Redo2 from './ph/arrow-u-up-right'
import RefreshCw from './ph/arrows-clockwise'
import Search from './ph/magnifying-glass'
import Settings from './ph/gear-six'
import Sparkles from './ph/sparkle'
import SquarePen from './ph/note-pencil'
import Trash2 from './ph/trash'
import TriangleAlert from './ph/warning'
import Unplug from './ph/plugs'
import Undo2 from './ph/arrow-u-up-left'
import Upload from './ph/upload-simple'
import UserRound from './ph/user'
import UserRoundCog from './ph/user-gear'
import UsersRound from './ph/users'
import Video from './ph/video-camera'
import Volume2 from './ph/speaker-high'
import VolumeX from './ph/speaker-x'
import WandSparkles from './ph/magic-wand'
import X from './ph/x'
import Zap from './ph/lightning'
import ChartBar from './ph/chart-bar'
import ClipboardText from './ph/clipboard-text'
import FilmStrip from './ph/film-strip'
import VideoCamera from './ph/video-camera'

export const iconRegistry = {
  clipboardCheckSolid: ClipboardText,
  statsBarGradient: ChartBar,
  statsEpisodeGradient: FilmStrip,
  statsImageGradient: Image,
  statsVideoGradient: VideoCamera,
  globe: Globe,
  folderHeart: FolderHeart,
  unplug: Unplug,
  userRoundCog: UserRoundCog,
  close: X,
  closeSm: X,
  closeMd: X,
  closeSolid: X,
  edit: Pencil,
  editSquare: SquarePen,
  trash: Trash2,
  trashAlt: Trash2,
  check: Check,
  checkSolid: Check,
  checkSm: Check,
  checkTiny: Check,
  checkXs: Check,
  checkDot: Check,
  checkMicro: Check,
  refresh: RefreshCw,
  plus: Plus,
  plusAlt: Plus,
  plusMd: Plus,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronRightMd: ChevronRight,
  chevronLeft: ChevronLeft,
  chevronUp: ChevronUp,
  mic: Mic,
  micOutline: Mic,
  bolt: Zap,
  image: Image,
  imageAlt: Image,
  imagePreview: Image,
  imageEdit: ImagePlus,
  imageLandscape: Image,
  video: Video,
  videoAlt: Video,
  videoWide: Video,
  sparkles: Sparkles,
  sparklesAlt: WandSparkles,
  alert: TriangleAlert,
  alertSolid: TriangleAlert,
  alertOutline: TriangleAlert,
  pause: Pause,
  pauseSolid: Pause,
  play: Play,
  playCircle: PlayCircle,
  search: Search,
  searchAdd: Search,
  searchPlus: Search,
  info: Info,
  infoCircle: Info,
  folder: Folder,
  folderCards: Folder,
  upload: Upload,
  undo: Undo2,
  redo: Redo2,
  copy: Copy,
  user: UserRound,
  userAlt: UserRound,
  usersRound: UsersRound,
  userCircle: CircleUser,
  package: Box,
  cube: Box,
  idea: Lightbulb,
  ideaAlt: Lightbulb,
  globe2: Globe,
  file: FileText,
  fileText: FileText,
  fileFold: FileText,
  eye: Eye,
  eyeOff: EyeOff,
  bookOpen: BookOpen,
  menu: Menu,
  loader: Loader2,
  settingsHex: Settings,
  settingsHexAlt: Settings,
  settingsHexMinor: Settings,
  audioWave: AudioLines,
  externalLink: ExternalLink,
  receipt: Receipt,
  download: Download,
  logout: LogOut,
  filter: Filter,
  minus: Minus,
  monitor: Monitor,
  coins: Coins,
  arrowRight: ArrowRight,
  arrowRightWide: ArrowRight,
  diamond: Diamond,
  lock: Lock,
  link: Link2,
  badgeCheck: BadgeCheck,
  cloudUpload: CloudUpload,
  cloud: Cloud,
  cloudOff: CloudOff,
  clipboardCheck: ClipboardCheck,
  clock: Clock3,
  chart: ChartColumn,
  statsBar: ChartColumn,
  volume: Volume2,
  volumeOff: VolumeX,
  wandOff: WandSparkles,
  bookmark: Bookmark,
  arrowDownCircle: ArrowDownCircle,
  barChart: ChartColumn,
  brain: Brain,
  clapperboard: Clapperboard,
  cpu: Cpu,
  film: Film,
  folderOpen: FolderOpen,
  gripVertical: GripVertical,
  history: History,
} as const satisfies Record<string, IconComponent>

export type AppIconName = keyof typeof iconRegistry
