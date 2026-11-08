import { FosAuthShell } from '@/components/frameos/FosAuthShell'
import { Link } from '@/i18n/navigation'

export default function SignUp() {
  return (
    <FosAuthShell
      title="账号由管理员分配"
      subtitle="LanMiaoTV 不开放自行注册。"
      footer="如需使用，请联系管理账号。"
    >
      <div className="nori-auth-managed-actions">
        <div className="nori-auth-managed-note">
          管理账号会为你创建账号并设置初始密码。子账号拥有统一创作能力，可访问的项目由项目成员关系决定。
        </div>
        <Link
          href={{ pathname: '/auth/signin' }}
          className="nori-auth-submit"
        >
          返回登录
        </Link>
      </div>
    </FosAuthShell>
  )
}
