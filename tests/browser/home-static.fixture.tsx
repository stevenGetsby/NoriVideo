import React from 'react'
import { renderToString } from 'react-dom/server'
import { LanmiaoHome } from '../../src/components/home/LanmiaoHome'

export const html = renderToString(<LanmiaoHome locale="zh" icp="测试备案号-1" />)
