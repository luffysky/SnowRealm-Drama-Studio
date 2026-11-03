/**
 * Money formatting and currency conversion.
 *
 * The ledger is the source of truth: `expenses` stores the amount **as
 * entered**, its own `currency`, the `exchange_rate` used at the time, and the
 * `base_currency` those rates reduce to (TWD). A stored figure is therefore
 * always reproducible — spec 23「保留原始幣別與匯率，金額不可虛構」.
 *
 * What this module adds is the *display* layer: totals come out of the database
 * in the base currency, and each member may read them in TWD, USD or CNY.
 * Conversion happens on render only; nothing converted is ever written back.
 *
 * The rates are entered by hand and carry the date they were taken. There is no
 * FX feed: a wrong rate that is visibly dated is honest, whereas a stale rate
 * presented as live is not.
 */

export const CURRENCIES = ['TWD', 'USD', 'CNY'] as const
export type CurrencyValue = (typeof CURRENCIES)[number]

/** The currency every stored total reduces to. Matches `expenses.base_currency`. */
export const BASE_CURRENCY: CurrencyValue = 'TWD'

export const CURRENCY_LABEL: Record<CurrencyValue, string> = {
  TWD: '新台幣',
  USD: '美金',
  CNY: '人民幣',
}

/**
 * Explicit symbols. `Intl` renders TWD as a bare `$` under zh-TW, which is
 * indistinguishable from USD — the one mistake this module exists to prevent.
 */
export const CURRENCY_SYMBOL: Record<CurrencyValue, string> = {
  TWD: 'NT$',
  USD: 'US$',
  CNY: 'CN¥',
}

/** Decimal places shown. TWD is not customarily written with cents. */
const FRACTION_DIGITS: Record<CurrencyValue, number> = {
  TWD: 0,
  USD: 2,
  CNY: 2,
}

export function isCurrency(value: unknown): value is CurrencyValue {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export type FxRates = {
  /** The currency the rates are quoted against. */
  base: CurrencyValue
  /** Units of each currency per 1 unit of `base`. */
  rates: Record<CurrencyValue, number>
  /** ISO date the rates were taken, shown next to converted figures. */
  asOf: string
  /** Free text, e.g. 「手動輸入」. */
  source: string
}

/**
 * Fallback used until someone sets rates in 專案設定.
 *
 * Deliberately round numbers with an explicit date: nobody should mistake
 * these for a live quote, and a converted total always shows the date beside
 * it so a stale figure is visible rather than silent.
 */
export const DEFAULT_FX: FxRates = {
  base: 'TWD',
  rates: { TWD: 1, USD: 0.031, CNY: 0.22 },
  asOf: '2026-11-03',
  source: '手動輸入（尚未於專案設定更新）',
}

/**
 * Converts between currencies using rates quoted against `fx.base`.
 * Returns the input untouched when the currencies match.
 */
export function convert(
  amount: number,
  from: CurrencyValue,
  to: CurrencyValue,
  fx: FxRates = DEFAULT_FX
): number {
  if (from === to) return amount

  const fromRate = fx.rates[from]
  const toRate = fx.rates[to]
  // A missing or nonsensical rate must not silently produce 0 or Infinity.
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) {
    throw new Error(`缺少 ${from} 或 ${to} 的匯率，無法換算`)
  }

  return (amount / fromRate) * toRate
}

/**
 * Formats an amount already expressed in `currency`.
 * Use `convert` first when the stored currency differs from the display one.
 */
export function formatMoney(amount: number, currency: CurrencyValue = BASE_CURRENCY): string {
  const digits = FRACTION_DIGITS[currency]
  const number = new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)

  return `${CURRENCY_SYMBOL[currency]}${number}`
}

/** Converts from the stored base currency and formats in one step. */
export function formatFromBase(
  amount: number,
  display: CurrencyValue,
  fx: FxRates = DEFAULT_FX
): string {
  return formatMoney(convert(amount, BASE_CURRENCY, display, fx), display)
}

/**
 * Note shown beside a converted figure, or null when no conversion happened.
 * A converted number without its rate and date is an unsourced claim.
 */
export function conversionNote(display: CurrencyValue, fx: FxRates = DEFAULT_FX): string | null {
  if (display === BASE_CURRENCY) return null

  const rate = fx.rates[display]
  if (!rate) return null

  return `依 1 ${CURRENCY_SYMBOL[BASE_CURRENCY]} = ${rate} ${CURRENCY_SYMBOL[display]} 換算（${fx.asOf}）`
}
