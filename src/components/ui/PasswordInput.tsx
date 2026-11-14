'use client'

import { forwardRef, useEffect, useState } from 'react'
import { Eye, EyeOff } from '@/components/ui/icons'

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapperClassName?: string
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { wrapperClassName, disabled, value, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (value === '') setVisible(false)
  }, [value])
  const label = visible ? '隐藏密码' : '显示密码'
  const Icon = visible ? EyeOff : Eye
  return (
    <span className={`nori-password-field${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>
      <input {...props} disabled={disabled} value={value} type={visible ? 'text' : 'password'} ref={ref} />
      <button
        type="button"
        className="nori-password-toggle"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
      >
        <Icon className="h-4 w-4" />
      </button>
    </span>
  )
})
