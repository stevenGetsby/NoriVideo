interface ShopItem {
  id: string
  name: string
  icon: string | null
  description: string
  price: number
}

interface ShopItemView {
  item: ShopItem
  owned: number
  soldOut: boolean
  affordable: boolean
}

interface ItemView {
  id: string
  name: string
  icon: string
  iconIsImage: boolean
  iconText: string
  description: string
  price: number
  owned: number
  buyLabel: string
  buyDisabled: boolean
  focused: boolean
}

Component({
  properties: {
    shop: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  data: {
    items: [] as ItemView[],
    hasCurrency: false,
    currencyName: '',
    currencyIcon: '',
    currencyIconIsImage: false,
    balance: 0,
  },
  observers: {
    shop(shop: {
      items?: ShopItemView[]
      currency?: { name: string; icon: string | null } | null
      balance?: number | null
      focusItemId?: string | null
    } | null) {
      if (!shop) return
      const currency = shop.currency
      const items: ItemView[] = (shop.items || []).map((view) => {
        const icon = view.item.icon || ''
        const iconIsImage = /^https?:\/\//.test(icon)
        return {
          id: view.item.id,
          name: view.item.name || '未命名商品',
          icon,
          iconIsImage,
          iconText: iconIsImage ? '' : icon || view.item.name.trim().slice(0, 1) || '物',
          description: view.item.description,
          price: view.item.price,
          owned: view.owned,
          buyLabel: view.soldOut ? '已售罄' : !view.affordable ? '余额不足' : '购买',
          buyDisabled: view.soldOut || !view.affordable,
          focused: view.item.id === shop.focusItemId,
        }
      })
      this.setData({
        items,
        hasCurrency: Boolean(currency),
        currencyName: currency?.name || '',
        currencyIcon: currency?.icon || '',
        currencyIconIsImage: /^https?:\/\//.test(currency?.icon || ''),
        balance: shop.balance ?? 0,
      })
    },
  },
  methods: {
    onBuy(e: { currentTarget: { dataset: { id: string } } }) {
      this.triggerEvent('buy', { itemId: e.currentTarget.dataset.id })
    },
    onClose() {
      this.triggerEvent('close')
    },
  },
})