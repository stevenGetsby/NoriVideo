Page({
  data: {
    slug: '',
    from: 'new',
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ slug: options.w || '', from: options.from || 'new' })
  },
})
