import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { createClerkSupabaseClient } from './supabase'
import './App.css'

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type TransactionType = 'income' | 'expense'

type Transaction = {
  id: string
  name: string
  category: string
  date: string
  amount: number
  type: TransactionType
}

type Budget = {
  id: string
  category: string
  amount: number
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// Shapes of the rows as they come back from Supabase.
type TransactionRow = {
  id: string
  title: string
  category: string
  date: string
  amount: number | string
  type: string
  created_at?: string
}

type BudgetRow = {
  id: string
  category: string
  amount: number | string
}

type ConfirmState = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

// Preference keys. Goal, currency and name are stored per account as
// `${key}:${userId}` so two people using one browser never share them.
// Theme is a device setting and stays global.
const GOAL_KEY = 'spendwise-goal'
const THEME_KEY = 'spendwise-theme'
const CURRENCY_KEY = 'spendwise-currency'
const NAME_KEY = 'spendwise-name'
const GUEST = 'guest'

const categories = ['Food', 'Entertainment', 'Transport', 'Shopping', 'Bills', 'Education', 'Health', 'Other']

const categoryColors: Record<string, string> = {
  Food: '#e0892f',
  Entertainment: '#7b61d1',
  Transport: '#2e7cc4',
  Shopping: '#d24b84',
  Bills: '#6b7a8c',
  Education: '#1f9e9b',
  Health: '#c4554a',
  Other: '#9aa3ae',
}

/*
 * SAMPLE DATA
 * These rows are NEVER inserted automatically. They are only written when a
 * signed-in user with an empty account clicks "Load sample data", and the
 * insert is re-checked against the database first (see loadSampleData).
 */
const sampleTransactions: { name: string; category: string; type: TransactionType; amount: number; daysAgo: number }[] = [
  { name: 'Grocery Shopping', category: 'Food', type: 'expense', amount: 1250, daysAgo: 0 },
  { name: 'Monthly Allowance', category: 'Income', type: 'income', amount: 5000, daysAgo: 1 },
  { name: 'Movie Tickets', category: 'Entertainment', type: 'expense', amount: 600, daysAgo: 3 },
  { name: 'Uber', category: 'Transport', type: 'expense', amount: 320, daysAgo: 4 },
]

const sampleBudgets: { category: string; amount: number }[] = [
  { category: 'Food', amount: 3000 },
  { category: 'Entertainment', amount: 2000 },
  { category: 'Transport', amount: 1500 },
  { category: 'Shopping', amount: 2000 },
]

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}

function colorFor(category: string) {
  if (category === 'Income') return 'var(--income)'
  return categoryColors[category] ?? categoryColors.Other
}

function catStyle(color: string): CSSProperties {
  return { '--cat': color } as CSSProperties
}

function isoDaysAgo(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

// New rows store a real date. Older rows may hold a label such as "Today" or
// "Sep 17" (the previous version saved the word "Today"); those are shown as-is.
function formatDate(value: string) {
  if (!ISO_DATE.test(value)) return value
  const d = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  if (value.slice(0, 10) === isoDaysAgo(0)) return 'Today'
  if (value.slice(0, 10) === isoDaysAgo(1)) return 'Yesterday'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    name: row.title,
    category: row.category,
    date: row.date,
    amount: Number(row.amount),
    type: row.type as TransactionType,
  }
}

function toBudget(row: BudgetRow): Budget {
  return { id: row.id, category: row.category, amount: Number(row.amount) }
}

function safeGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode / quota) - preferences just won't persist */
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

// Reads an account-scoped preference. The first signed-in account to open the app
// adopts the old un-scoped value (so nobody loses their settings) and the old key
// is removed so a second account can't inherit it.
function hydratePref(base: string, scope: string, fallback: string, ignoreLegacy?: string) {
  const scopedKey = `${base}:${scope}`
  const scoped = safeGet(scopedKey)
  if (scoped !== null) return scoped
  if (scope !== GUEST) {
    const legacy = safeGet(base)
    if (legacy !== null) {
      safeRemove(base)
      if (legacy !== ignoreLegacy) {
        safeSet(scopedKey, legacy)
        return legacy
      }
    }
  }
  return fallback
}

function csvCell(value: string) {
  // Prefix formula-looking text so spreadsheets don't execute it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/* -------------------------------------------------------------------------- */
/*  Icons (inline SVG, no extra dependency)                                    */
/* -------------------------------------------------------------------------- */

type IconName =
  | 'home' | 'swap' | 'wallet' | 'chart' | 'target' | 'settings' | 'plus'
  | 'arrow-up-right' | 'arrow-down-right' | 'download' | 'sun' | 'moon'
  | 'edit' | 'trash' | 'search' | 'x' | 'alert' | 'receipt' | 'refresh' | 'lock'

const ICONS: Record<IconName, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  swap: <><path d="m7 4-4 4 4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /><path d="M16 14.5h2" /></>,
  chart: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  settings: <><path d="M4 6h9M17 6h3" /><circle cx="15" cy="6" r="2" /><path d="M4 12h3M11 12h9" /><circle cx="9" cy="12" r="2" /><path d="M4 18h11M19 18h1" /><circle cx="17" cy="18" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  'arrow-up-right': <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
  'arrow-down-right': <><path d="M7 7l10 10" /><path d="M17 8v9H8" /></>,
  download: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.5v.01" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4" /><path d="M20 20v-4h-4" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/*  App                                                                        */
/* -------------------------------------------------------------------------- */

function App() {
  const clerk = useClerk()
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()

  const supabase = useMemo(
    () => createClerkSupabaseClient(getToken),
    [getToken]
  )

  const scope = userId ?? GUEST

  const [page, setPage] = useState('Dashboard')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [reloadTick, setReloadTick] = useState(0)

  const [goal, setGoal] = useState('10000')
  const [theme, setTheme] = useState(() => {
    const stored = safeGet(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [currency, setCurrency] = useState('INR')
  const [displayName, setDisplayName] = useState('')
  const [hydratedScope, setHydratedScope] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState<TransactionType>('expense')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Food')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [budgetModal, setBudgetModal] = useState(false)
  const [budgetCategory, setBudgetCategory] = useState('Food')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetError, setBudgetError] = useState('')

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toast, setToast] = useState<{ id: number; message: string; tone: 'success' | 'error' } | null>(null)
  const [seeding, setSeeding] = useState(false)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [sortBy, setSortBy] = useState('newest')

  // Guards that keep one account's data from leaking into another's state.
  const activeUserRef = useRef<string | null>(userId ?? null)
  useLayoutEffect(() => {
    activeUserRef.current = userId ?? null
  }, [userId])
  const dataOwnerRef = useRef<string | null>(null)
  const seedingRef = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const notify = (message: string, tone: 'success' | 'error' = 'success') => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message, tone })
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const retryLoad = () => setReloadTick(t => t + 1)

  /* ---------------------------- Load account data --------------------------- */

  useEffect(() => {
    if (!isLoaded) return

    if (!isSignedIn || !userId) {
      dataOwnerRef.current = null
      setTransactions([])
      setBudgets([])
      setStatus('idle')
      return
    }

    // A different account signed in: drop the previous account's data immediately
    // so it is never visible to (or merged with) the new account.
    if (dataOwnerRef.current !== userId) {
      dataOwnerRef.current = userId
      setTransactions([])
      setBudgets([])
      setStatus('loading')
    } else {
      setStatus(s => (s === 'ready' ? s : 'loading'))
    }

    let cancelled = false

    const load = async () => {
      // The user_id filter is defence in depth; row-level security is the real guard.
      const [tx, bd] = await Promise.all([
        supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('budgets').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      ])

      if (cancelled) return

      if (tx.error || bd.error) {
        console.error('Failed to load data:', tx.error ?? bd.error)
        setStatus('error')
        return
      }

      setTransactions(((tx.data ?? []) as TransactionRow[]).map(toTransaction))
      setBudgets(((bd.data ?? []) as BudgetRow[]).map(toBudget))
      setStatus('ready')
    }

    load().catch(err => {
      if (cancelled) return
      console.error('Failed to load data:', err)
      setStatus('error')
    })

    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn, userId, supabase, reloadTick])

  /* ------------------------------ Preferences ------------------------------- */

  useEffect(() => {
    if (!isLoaded) return
    const firstName = clerk.user?.firstName ?? ''
    const fallbackName = firstName || (scope === GUEST ? 'Guest' : '')
    setGoal(hydratePref(GOAL_KEY, scope, '10000'))
    setCurrency(hydratePref(CURRENCY_KEY, scope, 'INR'))
    // "Master" was the old built-in default, so treat it as "never set".
    const storedName = hydratePref(NAME_KEY, scope, fallbackName, 'Master')
    setDisplayName(storedName)
    setHydratedScope(scope)
  }, [isLoaded, scope, clerk])

  useEffect(() => {
    if (hydratedScope === scope) safeSet(`${GOAL_KEY}:${scope}`, goal)
  }, [goal, scope, hydratedScope])

  useEffect(() => {
    if (hydratedScope === scope) safeSet(`${CURRENCY_KEY}:${scope}`, currency)
  }, [currency, scope, hydratedScope])

  useEffect(() => {
    if (hydratedScope === scope) safeSet(`${NAME_KEY}:${scope}`, displayName)
  }, [displayName, scope, hydratedScope])

  useEffect(() => {
    safeSet(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [page])

  /* -------------------------------- Derived --------------------------------- */

  const totalIncome = useMemo(
    () => transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  )

  const totalExpenses = useMemo(
    () => transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  )

  const balance = totalIncome - totalExpenses

  const categoryTotals = useMemo(() => {
    return categories.map(cat => ({
      category: cat,
      total: transactions
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((sum, t) => sum + t.amount, 0),
    }))
  }, [transactions])

  const maxCategoryTotal = Math.max(...categoryTotals.map(x => x.total), 1)

  const filtersActive = search.trim() !== '' || filterType !== 'all' || filterCategory !== 'all'

  const filteredTransactions = useMemo(() => {
    const result = transactions.filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(search.trim().toLowerCase())
      const matchesType = filterType === 'all' || t.type === filterType
      const matchesCategory = filterCategory === 'all' || t.category === filterCategory
      return matchesSearch && matchesType && matchesCategory
    })

    // `transactions` is already newest-first (database order, new rows are prepended).
    if (sortBy === 'amount-high') return [...result].sort((a, b) => b.amount - a.amount)
    if (sortBy === 'amount-low') return [...result].sort((a, b) => a.amount - b.amount)
    if (sortBy === 'name') return [...result].sort((a, b) => a.name.localeCompare(b.name))
    return result
  }, [transactions, search, filterType, filterCategory, sortBy])

  const clearFilters = () => {
    setSearch('')
    setFilterType('all')
    setFilterCategory('all')
  }

  const budgetTotal = budgets.reduce((sum, b) => sum + b.amount, 0)
  const budgetSpent = totalExpenses
  const budgetPercent = budgetTotal ? Math.min((budgetSpent / budgetTotal) * 100, 100) : 0

  const stillCurrent = (id: string) => activeUserRef.current === id

  /* ----------------------------- Transactions ------------------------------- */

  const openAdd = (type: TransactionType) => {
    setModalType(type)
    setEditingId(null)
    setName('')
    setAmount('')
    setCategory(type === 'income' ? 'Income' : 'Food')
    setError('')
    setShowModal(true)
  }

  const openEdit = (transaction: Transaction) => {
    setModalType(transaction.type)
    setEditingId(transaction.id)
    setName(transaction.name)
    setAmount(String(transaction.amount))
    setCategory(transaction.type === 'income' ? 'Income' : transaction.category)
    setError('')
    setShowModal(true)
  }

  const switchModalType = (type: TransactionType) => {
    setModalType(type)
    if (type === 'expense' && !categories.includes(category)) setCategory('Food')
  }

  const saveTransaction = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return

    const numericAmount = Number(amount)

    if (!name.trim()) {
      setError('Enter a name for this transaction.')
      return
    }

    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    if (numericAmount > 999_999_999) {
      setError('That amount is too large.')
      return
    }

    if (!isLoaded || !isSignedIn || !userId) {
      setError('Sign in to save transactions.')
      return
    }

    setSaving(true)
    try {
      if (editingId !== null) {
        const { data, error } = await supabase
          .from('transactions')
          .update({
            title: name.trim(),
            amount: numericAmount,
            category: modalType === 'income' ? 'Income' : category,
            type: modalType,
          })
          .eq('id', editingId)
          .eq('user_id', userId)
          .select()
          .single()

        if (!stillCurrent(userId)) return

        if (error) {
          console.error('Failed to update transaction:', error)
          setError('Could not save your changes. Check your connection and try again.')
          return
        }

        const updated = toTransaction(data as TransactionRow)
        setTransactions(current => current.map(t => (t.id === editingId ? updated : t)))
        notify('Changes saved')
      } else {
        const { data, error } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            title: name.trim(),
            amount: numericAmount,
            type: modalType,
            category: modalType === 'income' ? 'Income' : category,
            date: isoDaysAgo(0),
          })
          .select()
          .single()

        if (!stillCurrent(userId)) return

        if (error) {
          console.error('Failed to add transaction:', error)
          setError('Could not add this transaction. Check your connection and try again.')
          return
        }

        setTransactions(current => [toTransaction(data as TransactionRow), ...current])
        notify(modalType === 'income' ? 'Income added' : 'Expense added')
      }

      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }

  const askConfirm = (state: ConfirmState) => setConfirmState(state)

  const deleteTransaction = (id: string) => {
    const target = transactions.find(t => t.id === id)
    if (!target || !userId) return
    const owner = userId

    askConfirm({
      title: 'Delete this transaction?',
      message: `"${target.name}" will be removed permanently.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const { error } = await supabase
          .from('transactions')
          .delete()
          .eq('id', id)
          .eq('user_id', owner)

        if (!stillCurrent(owner)) return

        if (error) {
          console.error('Failed to delete transaction:', error)
          notify('Could not delete the transaction. Try again.', 'error')
          return
        }

        setTransactions(current => current.filter(t => t.id !== id))
        notify('Transaction deleted')
      },
    })
  }

  /* -------------------------------- Budgets --------------------------------- */

  const addOrUpdateBudget = (budget?: Budget) => {
    setBudgetCategory(budget?.category ?? categories.find(c => !budgets.some(b => b.category.toLowerCase() === c.toLowerCase())) ?? 'Food')
    setBudgetAmount(budget ? String(budget.amount) : '')
    setBudgetError('')
    setBudgetModal(true)
  }

  const saveBudget = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return

    const cat = budgetCategory.trim()
    const value = Number(budgetAmount)

    if (!cat) {
      setBudgetError('Choose a category.')
      return
    }

    if (!budgetAmount || !Number.isFinite(value) || value <= 0) {
      setBudgetError('Enter a budget greater than zero.')
      return
    }

    if (!isLoaded || !isSignedIn || !userId) {
      setBudgetError('Sign in to save budgets.')
      return
    }

    const existing = budgets.find(b => b.category.toLowerCase() === cat.toLowerCase())

    setSaving(true)
    try {
      if (existing) {
        const { data, error } = await supabase
          .from('budgets')
          .update({ amount: value, category: existing.category })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single()

        if (!stillCurrent(userId)) return

        if (error) {
          console.error('Failed to update budget:', error)
          setBudgetError('Could not update the budget. Try again.')
          return
        }

        const updated = toBudget(data as BudgetRow)
        setBudgets(current => current.map(b => (b.id === existing.id ? updated : b)))
      } else {
        const { data, error } = await supabase
          .from('budgets')
          .insert({ user_id: userId, category: cat, amount: value })
          .select()
          .single()

        if (!stillCurrent(userId)) return

        if (error) {
          console.error('Failed to add budget:', error)
          setBudgetError('Could not add the budget. Try again.')
          return
        }

        setBudgets(current => [...current, toBudget(data as BudgetRow)])
      }

      setBudgetModal(false)
      notify('Budget saved')
    } finally {
      setSaving(false)
    }
  }

  const deleteBudget = (id: string) => {
    const budget = budgets.find(b => b.id === id)
    if (!budget || !userId) return
    const owner = userId

    askConfirm({
      title: `Delete the ${budget.category} budget?`,
      message: 'Your transactions are not affected.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const { error } = await supabase
          .from('budgets')
          .delete()
          .eq('id', id)
          .eq('user_id', owner)

        if (!stillCurrent(owner)) return

        if (error) {
          console.error('Failed to delete budget:', error)
          notify('Could not delete the budget. Try again.', 'error')
          return
        }

        setBudgets(current => current.filter(b => b.id !== id))
        notify('Budget deleted')
      },
    })
  }

  /* ------------------------------ Sample data ------------------------------- */

  // Deliberate, one-click, empty-account-only. Never runs on load, refresh or login.
  const loadSampleData = async () => {
    if (!isLoaded || !isSignedIn || !userId) return
    if (seedingRef.current || status !== 'ready') return
    if (transactions.length > 0) return
    const owner = userId

    seedingRef.current = true
    setSeeding(true)
    try {
      // Re-check on the server: another tab or device may have added data since this page loaded.
      const { count, error: countError } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', owner)

      if (countError) throw countError
      if (!stillCurrent(owner)) return

      if ((count ?? 0) > 0) {
        notify('Your account already has transactions, so nothing was added.', 'error')
        retryLoad()
        return
      }

      const now = Date.now()
      const txRows = sampleTransactions.map((s, i) => ({
        user_id: owner,
        title: s.name,
        amount: s.amount,
        type: s.type,
        category: s.category,
        date: isoDaysAgo(s.daysAgo),
        created_at: new Date(now - s.daysAgo * 86_400_000 - i).toISOString(),
      }))

      const txResult = await supabase.from('transactions').insert(txRows).select()
      if (txResult.error) throw txResult.error
      if (!stillCurrent(owner)) return

      const inserted = ((txResult.data ?? []) as TransactionRow[])
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      setTransactions(inserted.map(toTransaction))

      if (budgets.length === 0) {
        const bdResult = await supabase
          .from('budgets')
          .insert(sampleBudgets.map(b => ({ user_id: owner, category: b.category, amount: b.amount })))
          .select()
        if (bdResult.error) throw bdResult.error
        if (!stillCurrent(owner)) return
        setBudgets(((bdResult.data ?? []) as BudgetRow[]).map(toBudget))
      }

      notify('Sample data added')
    } catch (err) {
      console.error('Failed to load sample data:', err)
      notify('Could not add sample data. Try again.', 'error')
      retryLoad()
    } finally {
      seedingRef.current = false
      setSeeding(false)
    }
  }

  /* ------------------------------ Data / prefs ------------------------------ */

  const exportCSV = () => {
    if (!transactions.length) {
      notify('There are no transactions to export yet.', 'error')
      return
    }

    const rows = [
      ['Name', 'Type', 'Category', 'Amount', 'Date'],
      ...transactions.map(t => [t.name, t.type, t.category, String(t.amount), t.date]),
    ]
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'spendwise-transactions.csv'
    link.click()
    URL.revokeObjectURL(url)
    notify('Transactions exported')
  }

  const clearAllData = () => {
    askConfirm({
      title: 'Reset your savings goal?',
      message: 'The goal returns to 10,000. Your transactions and budgets are not changed.',
      confirmLabel: 'Reset goal',
      onConfirm: () => {
        setGoal('10000')
        notify('Savings goal reset')
      },
    })
  }

  const resetApp = () => {
    askConfirm({
      title: 'Reset preferences?',
      message: 'Display name, currency, theme and savings goal return to their defaults. Your transactions and budgets are not changed.',
      confirmLabel: 'Reset preferences',
      onConfirm: () => {
        setGoal('10000')
        setDisplayName(clerk.user?.firstName ?? (isSignedIn ? '' : 'Guest'))
        setTheme('light')
        setCurrency('INR')
        notify('Preferences reset')
      },
    })
  }

  /* --------------------------------- Render --------------------------------- */

  const navItems: [string, IconName][] = [
    ['Dashboard', 'home'],
    ['Transactions', 'swap'],
    ['Budgets', 'wallet'],
    ['Analytics', 'chart'],
    ['Goals', 'target'],
    ['Settings', 'settings'],
  ]

  const needsData = page !== 'Settings'
  const showFab = isSignedIn && status === 'ready' && transactions.length > 0 && (page === 'Dashboard' || page === 'Transactions')

  const budgetCategoryOptions = [
    ...categories,
    ...budgets
      .map(b => b.category)
      .filter(c => !categories.some(x => x.toLowerCase() === c.toLowerCase())),
  ]
  const budgetIsUpdate = budgets.some(b => b.category.toLowerCase() === budgetCategory.toLowerCase())
  const categoryOptions = categories.includes(category) ? categories : [category, ...categories]

  const renderPage = () => {
    if (needsData) {
      if (!isLoaded || status === 'loading') return <PageSkeleton />
      if (!isSignedIn) {
        return <SignedOutPanel onSignIn={() => clerk.openSignIn({})} onSignUp={() => clerk.openSignUp({})} />
      }
      if (status === 'error') return <LoadError onRetry={retryLoad} />
    }

    switch (page) {
      case 'Dashboard':
        return (
          <Dashboard
            displayName={displayName}
            currency={currency}
            transactions={transactions}
            totalIncome={totalIncome}
            totalExpenses={totalExpenses}
            balance={balance}
            budgetTotal={budgetTotal}
            budgetSpent={budgetSpent}
            budgetPercent={budgetPercent}
            categoryTotals={categoryTotals}
            maxCategoryTotal={maxCategoryTotal}
            openAdd={openAdd}
            openEdit={openEdit}
            deleteTransaction={deleteTransaction}
            goTransactions={() => setPage('Transactions')}
            goBudgets={() => setPage('Budgets')}
            loadSampleData={loadSampleData}
            seeding={seeding}
          />
        )
      case 'Transactions':
        return (
          <TransactionsPage
            currency={currency}
            transactions={filteredTransactions}
            totalCount={transactions.length}
            filtersActive={filtersActive}
            clearFilters={clearFilters}
            search={search}
            setSearch={setSearch}
            filterType={filterType}
            setFilterType={setFilterType}
            filterCategory={filterCategory}
            setFilterCategory={setFilterCategory}
            sortBy={sortBy}
            setSortBy={setSortBy}
            openAdd={openAdd}
            openEdit={openEdit}
            deleteTransaction={deleteTransaction}
            loadSampleData={loadSampleData}
            seeding={seeding}
          />
        )
      case 'Budgets':
        return (
          <BudgetsPage
            currency={currency}
            budgets={budgets}
            transactions={transactions}
            addOrUpdateBudget={addOrUpdateBudget}
            deleteBudget={deleteBudget}
          />
        )
      case 'Analytics':
        return (
          <AnalyticsPage
            currency={currency}
            transactions={transactions}
            categoryTotals={categoryTotals}
            maxCategoryTotal={maxCategoryTotal}
            openAdd={openAdd}
          />
        )
      case 'Goals':
        return <GoalsPage currency={currency} balance={balance} goal={goal} setGoal={setGoal} />
      case 'Settings':
        return (
          <SettingsPage
            displayName={displayName}
            setDisplayName={setDisplayName}
            currency={currency}
            setCurrency={setCurrency}
            theme={theme}
            setTheme={setTheme}
            exportCSV={exportCSV}
            clearAllData={clearAllData}
            resetApp={resetApp}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">S</div>
          <div>
            <strong>SpendWise</strong>
            <span>Personal Finance</span>
          </div>
        </div>

        <nav aria-label="Main">
          {navItems.map(([item, icon]) => (
            <button
              key={item}
              type="button"
              className={page === item ? 'nav-item active' : 'nav-item'}
              aria-current={page === item ? 'page' : undefined}
              onClick={() => setPage(item)}
            >
              <Icon name={icon} />
              <span>{item}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="mini-goal">
            <span>Monthly budget</span>
            <strong>{money(budgetSpent, currency)} / {money(budgetTotal, currency)}</strong>
            <div className="progress" role="progressbar" aria-label="Monthly budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budgetPercent)}>
              <i style={{ width: `${budgetPercent}%` }} />
            </div>
          </div>
          <button type="button" className="export-button" onClick={exportCSV}>
            <Icon name="download" size={16} /> Export CSV
          </button>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        <header className="topbar">
          <h1>{page}</h1>
          <div className="top-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              title={theme === 'light' ? 'Dark theme' : 'Light theme'}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>

            <div className="auth-controls">
              {!isLoaded ? (
                <span className="auth-loading">Loading…</span>
              ) : isSignedIn ? (
                <UserButton />
              ) : (
                <>
                  <button type="button" className="auth-button secondary" onClick={() => clerk.openSignIn({})}>Sign in</button>
                  <button type="button" className="auth-button primary" onClick={() => clerk.openSignUp({})}>Sign up</button>
                </>
              )}
            </div>

            {isLoaded && !isSignedIn && (
              <div className="avatar" aria-hidden="true">{(displayName || 'G').charAt(0).toUpperCase()}</div>
            )}
          </div>
        </header>

        {renderPage()}
      </main>

      {showFab && (
        <button type="button" className="fab" aria-label="Add expense" onClick={() => openAdd('expense')}>
          <Icon name="plus" size={22} />
        </button>
      )}

      {showModal && (
        <Modal labelledBy="tx-modal-title" onClose={() => setShowModal(false)}>
          <form onSubmit={saveTransaction} noValidate>
            <div className="modal-header">
              <h2 id="tx-modal-title">{editingId !== null ? 'Edit transaction' : `Add ${modalType}`}</h2>
              <button type="button" className="close-button" onClick={() => setShowModal(false)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>

            <div className="type-switch" role="group" aria-label="Transaction type">
              <button type="button" aria-pressed={modalType === 'expense'} className={modalType === 'expense' ? 'selected' : ''} onClick={() => switchModalType('expense')}>Expense</button>
              <button type="button" aria-pressed={modalType === 'income'} className={modalType === 'income' ? 'selected income' : ''} onClick={() => switchModalType('income')}>Income</button>
            </div>

            <div className="field">
              <label htmlFor="tx-name">Name</label>
              <input id="tx-name" data-autofocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder={modalType === 'expense' ? 'e.g. Groceries' : 'e.g. Allowance'} autoComplete="off" />
            </div>

            <div className="field">
              <label htmlFor="tx-amount">Amount ({currency})</label>
              <input id="tx-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            </div>

            {modalType === 'expense' && (
              <div className="field">
                <label htmlFor="tx-category">Category</label>
                <select id="tx-category" value={category} onChange={e => setCategory(e.target.value)}>
                  {categoryOptions.map(cat => <option key={cat}>{cat}</option>)}
                </select>
              </div>
            )}

            {error && <div className="error" role="alert">{error}</div>}

            <button type="submit" className="primary-button full" disabled={saving}>
              {saving ? 'Saving…' : editingId !== null ? 'Save changes' : `Add ${modalType}`}
            </button>
          </form>
        </Modal>
      )}

      {budgetModal && (
        <Modal labelledBy="budget-modal-title" onClose={() => setBudgetModal(false)}>
          <form onSubmit={saveBudget} noValidate>
            <div className="modal-header">
              <h2 id="budget-modal-title">{budgetIsUpdate ? 'Update budget' : 'Add budget'}</h2>
              <button type="button" className="close-button" onClick={() => setBudgetModal(false)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>

            <div className="field">
              <label htmlFor="budget-category">Category</label>
              <select id="budget-category" data-autofocus value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)}>
                {budgetCategoryOptions.map(cat => <option key={cat}>{cat}</option>)}
              </select>
              {budgetIsUpdate && <small className="hint">You already have a {budgetCategory} budget. Saving replaces its limit.</small>}
            </div>

            <div className="field">
              <label htmlFor="budget-amount">Monthly limit ({currency})</label>
              <input id="budget-amount" type="number" inputMode="decimal" min="0" step="any" value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} placeholder="2000" />
            </div>

            {budgetError && <div className="error" role="alert">{budgetError}</div>}

            <button type="submit" className="primary-button full" disabled={saving}>
              {saving ? 'Saving…' : budgetIsUpdate ? 'Update budget' : 'Add budget'}
            </button>
          </form>
        </Modal>
      )}

      {confirmState && (
        <Modal role="alertdialog" labelledBy="confirm-title" describedBy="confirm-message" size="small" onClose={() => setConfirmState(null)}>
          <h2 id="confirm-title" className="confirm-title">{confirmState.title}</h2>
          <p id="confirm-message" className="muted">{confirmState.message}</p>
          <div className="confirm-actions">
            <button type="button" className="secondary-button" data-autofocus onClick={() => setConfirmState(null)}>Cancel</button>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                const current = confirmState
                setConfirmState(null)
                void current.onConfirm()
              }}
            >
              {confirmState.confirmLabel}
            </button>
          </div>
        </Modal>
      )}

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.tone === 'error' && <Icon name="alert" size={16} />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Shared UI                                                                  */
/* -------------------------------------------------------------------------- */

function Modal({ children, onClose, labelledBy, describedBy, role = 'dialog', size }: {
  children: ReactNode
  onClose: () => void
  labelledBy: string
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  size?: 'small'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const panel = panelRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.hasAttribute('disabled'))
        : []

    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
    first?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const head = items[0]
      const tail = items[items.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={size === 'small' ? 'modal small' : 'modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </div>
    </div>
  )
}

function Empty({ title, text, children }: { title?: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {title && <strong>{title}</strong>}
      <p>{text}</p>
      {children}
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="content" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your data…</span>
      <div className="skeleton sk-title" />
      <div className="skeleton sk-hero" />
      <div className="dashboard-grid">
        <div className="skeleton sk-panel" />
        <div className="skeleton sk-panel" />
      </div>
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="content">
      <section className="panel state-panel error-state" role="alert">
        <div className="state-icon"><Icon name="alert" size={26} /></div>
        <h2>We couldn't load your data</h2>
        <p>Check your connection and try again. Nothing has been changed.</p>
        <button type="button" className="primary-button" onClick={onRetry}><Icon name="refresh" size={16} /> Try again</button>
      </section>
    </div>
  )
}

function SignedOutPanel({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  return (
    <div className="content">
      <section className="panel state-panel">
        <div className="state-icon"><Icon name="lock" size={26} /></div>
        <h2>Sign in to see your money</h2>
        <p>Your transactions and budgets are saved to your account, so they stay private and follow you across devices.</p>
        <div className="action-row center">
          <button type="button" className="primary-button" onClick={onSignIn}>Sign in</button>
          <button type="button" className="secondary-button" onClick={onSignUp}>Create an account</button>
        </div>
      </section>
    </div>
  )
}

function FirstRun({ openAdd, loadSampleData, seeding }: { openAdd: (type: TransactionType) => void; loadSampleData: () => void; seeding: boolean }) {
  return (
    <section className="panel state-panel first-run">
      <div className="state-icon"><Icon name="receipt" size={28} /></div>
      <h2>No expenses yet</h2>
      <p>Start tracking your spending by adding your first expense.</p>
      <div className="action-row center">
        <button type="button" className="primary-button" onClick={() => openAdd('expense')}><Icon name="plus" size={16} /> Add your first expense</button>
        <button type="button" className="secondary-button" onClick={() => openAdd('income')}>Add income</button>
      </div>
      <div className="sample-offer">
        <span>Want to look around first?</span>
        <button type="button" className="text-button" onClick={loadSampleData} disabled={seeding}>
          {seeding ? 'Adding sample data…' : 'Load sample data'}
        </button>
        <small>Adds a few example entries to your account once, and only when you choose.</small>
      </div>
    </section>
  )
}

function StatCard({ label, value, note, icon, positive = false }: { label: string; value: string; note: string; icon: IconName; positive?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><b className={positive ? 'positive-icon' : ''}><Icon name={icon} size={16} /></b></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  )
}

function Donut({ segments, total, currency, size = 176, thickness = 20 }: {
  segments: { category: string; total: number }[]
  total: number
  currency: string
  size?: number
  thickness?: number
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const gap = segments.length > 1 ? 2 : 0
  const arcs = segments.reduce<{ category: string; len: number; offset: number }[]>((list, s) => {
    const last = list[list.length - 1]
    const offset = last ? last.offset + last.len : 0
    return [...list, { category: s.category, len: (s.total / total) * c, offset }]
  }, [])

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share of spending by category">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {arcs.map(a => (
          <circle
            key={a.category}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={colorFor(a.category)}
            strokeWidth={thickness}
            strokeDasharray={`${Math.max(a.len - gap, 0)} ${c}`}
            strokeDashoffset={-a.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
      </svg>
      <div className="donut-center"><span>Total spent</span><strong>{money(total, currency)}</strong></div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Pages                                                                      */
/* -------------------------------------------------------------------------- */

function Dashboard(props: {
  displayName: string
  currency: string
  transactions: Transaction[]
  totalIncome: number
  totalExpenses: number
  balance: number
  budgetTotal: number
  budgetSpent: number
  budgetPercent: number
  categoryTotals: { category: string; total: number }[]
  maxCategoryTotal: number
  openAdd: (type: TransactionType) => void
  openEdit: (t: Transaction) => void
  deleteTransaction: (id: string) => void
  goTransactions: () => void
  goBudgets: () => void
  loadSampleData: () => void
  seeding: boolean
}) {
  const {
    displayName, currency, transactions, totalIncome, totalExpenses, balance,
    budgetTotal, budgetSpent, budgetPercent, categoryTotals, maxCategoryTotal,
    openAdd, openEdit, deleteTransaction, goTransactions, goBudgets, loadSampleData, seeding,
  } = props

  const hasTransactions = transactions.length > 0
  const expenseCategories = categoryTotals.filter(x => x.total > 0)
  const spentShare = totalIncome > 0 ? totalExpenses / totalIncome : null
  const overIncome = spentShare !== null && spentShare > 1
  const budgetOver = budgetTotal > 0 && budgetSpent > budgetTotal

  return (
    <div className="content">
      <section className="welcome">
        <div>
          <h2>{greeting()}{displayName ? `, ${displayName}` : ''}</h2>
          <p>Here's what your money is doing right now.</p>
        </div>
        {hasTransactions && (
          <div className="action-row">
            <button type="button" className="secondary-button" onClick={() => openAdd('income')}><Icon name="plus" size={16} /> Add income</button>
            <button type="button" className="primary-button" onClick={() => openAdd('expense')}><Icon name="plus" size={16} /> Add expense</button>
          </div>
        )}
      </section>

      {!hasTransactions ? (
        <FirstRun openAdd={openAdd} loadSampleData={loadSampleData} seeding={seeding} />
      ) : (
        <>
          <section className="panel ledger">
            <div className="ledger-main">
              <span className="ledger-label">Current balance</span>
              <strong className={balance < 0 ? 'ledger-figure negative' : 'ledger-figure'}>{money(balance, currency)}</strong>
              <span className="ledger-note">{balance >= 0 ? 'Available balance' : 'Over your income'}</span>
            </div>
            <dl className="ledger-stats">
              <div><dt>Income</dt><dd className="income">+{money(totalIncome, currency)}</dd></div>
              <div><dt>Expenses</dt><dd>{money(totalExpenses, currency)}</dd></div>
              <div><dt>Budget used</dt><dd className={budgetOver ? 'over' : ''}>{budgetTotal ? `${Math.round(budgetPercent)}%` : 'Not set'}</dd></div>
            </dl>
            {spentShare !== null && (
              <div className="split">
                <div
                  className={overIncome ? 'split-bar over' : 'split-bar'}
                  role="progressbar"
                  aria-label="Share of income spent"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(Math.round(spentShare * 100), 100)}
                >
                  <i style={{ width: `${Math.min(spentShare, 1) * 100}%` }} />
                </div>
                <div className="split-meta">
                  <span>{overIncome ? 'Spending is above your income' : `Spent ${Math.round(spentShare * 100)}% of income`}</span>
                  {!overIncome && <span>{money(Math.max(balance, 0), currency)} kept</span>}
                </div>
              </div>
            )}
          </section>

          <section className="dashboard-grid">
            <div className="panel">
              <div className="panel-heading">
                <div><h3>Recent transactions</h3><p>Your latest activity</p></div>
                <button type="button" className="text-button" onClick={goTransactions}>View all</button>
              </div>
              <TransactionList transactions={transactions.slice(0, 6)} currency={currency} openEdit={openEdit} deleteTransaction={deleteTransaction} />
            </div>

            <div className="panel">
              <div className="panel-heading">
                <div><h3>Spending by category</h3><p>Where your money goes</p></div>
              </div>
              {expenseCategories.length === 0 ? (
                <Empty title="No expenses yet" text="Start tracking your spending by adding your first expense.">
                  <button type="button" className="secondary-button" onClick={() => openAdd('expense')}><Icon name="plus" size={16} /> Add expense</button>
                </Empty>
              ) : (
                <div className="category-bars">
                  {expenseCategories.map(item => (
                    <div className="bar-row" key={item.category} style={catStyle(colorFor(item.category))}>
                      <div className="bar-label"><span>{item.category}</span><strong>{money(item.total, currency)}</strong></div>
                      <div className="bar-track"><i style={{ width: `${(item.total / maxCategoryTotal) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel budget-panel">
            <div className="panel-heading">
              <div><h3>Monthly budget</h3><p>Track your overall spending limit</p></div>
              {budgetTotal > 0 && <strong className="figure">{money(budgetSpent, currency)} / {money(budgetTotal, currency)}</strong>}
            </div>
            {budgetTotal > 0 ? (
              <>
                <div className={budgetOver ? 'large-progress over' : 'large-progress'} role="progressbar" aria-label="Monthly budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budgetPercent)}>
                  <i style={{ width: `${budgetPercent}%` }} />
                </div>
                <p className="muted">
                  {budgetOver
                    ? `You're ${money(budgetSpent - budgetTotal, currency)} over your combined budget.`
                    : budgetPercent >= 100
                      ? 'Budget reached.'
                      : `${money(Math.max(budgetTotal - budgetSpent, 0), currency)} remaining this month.`}
                </p>
              </>
            ) : (
              <Empty text="Set spending limits by category to see how much you have left each month.">
                <button type="button" className="secondary-button" onClick={goBudgets}>Set a budget</button>
              </Empty>
            )}
          </section>

          <section className="quick-actions" aria-label="Quick actions">
            <button type="button" onClick={() => openAdd('expense')}><span><Icon name="plus" /></span><div><strong>Add expense</strong><small>Record spending</small></div></button>
            <button type="button" onClick={() => openAdd('income')}><span><Icon name="arrow-up-right" /></span><div><strong>Add income</strong><small>Record money received</small></div></button>
            <button type="button" onClick={goTransactions}><span><Icon name="swap" /></span><div><strong>Manage transactions</strong><small>Search and edit</small></div></button>
          </section>
        </>
      )}
    </div>
  )
}

function TransactionList({ transactions, currency, openEdit, deleteTransaction }: { transactions: Transaction[]; currency: string; openEdit: (t: Transaction) => void; deleteTransaction: (id: string) => void }) {
  if (!transactions.length) return <Empty text="No transactions yet." />
  return (
    <ul className="transaction-list">
      {transactions.map(t => (
        <li className="transaction" key={t.id}>
          <span className={`transaction-icon ${t.type}`} style={catStyle(colorFor(t.category))} aria-hidden="true">
            <Icon name={t.type === 'income' ? 'arrow-up-right' : 'arrow-down-right'} size={16} />
          </span>
          <div className="transaction-info">
            <strong>{t.name}</strong>
            <span className="transaction-meta"><span className="tag">{t.category}</span><time>{formatDate(t.date)}</time></span>
          </div>
          <strong className={t.type === 'income' ? 'amount income' : 'amount'}>{t.type === 'income' ? '+' : '−'}{money(t.amount, currency)}</strong>
          <div className="row-actions">
            <button type="button" className="icon-action" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`} title="Edit"><Icon name="edit" size={16} /></button>
            <button type="button" className="icon-action danger" onClick={() => deleteTransaction(t.id)} aria-label={`Delete ${t.name}`} title="Delete"><Icon name="trash" size={16} /></button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function TransactionsPage(props: {
  currency: string
  transactions: Transaction[]
  totalCount: number
  filtersActive: boolean
  clearFilters: () => void
  search: string
  setSearch: (v: string) => void
  filterType: string
  setFilterType: (v: string) => void
  filterCategory: string
  setFilterCategory: (v: string) => void
  sortBy: string
  setSortBy: (v: string) => void
  openAdd: (type: TransactionType) => void
  openEdit: (t: Transaction) => void
  deleteTransaction: (id: string) => void
  loadSampleData: () => void
  seeding: boolean
}) {
  return (
    <div className="content">
      <section className="page-actions">
        <div><h2>All transactions</h2><p>Search, filter, sort and manage your money.</p></div>
        <div className="action-row"><button type="button" className="secondary-button" onClick={() => props.openAdd('income')}><Icon name="plus" size={16} /> Income</button><button type="button" className="primary-button" onClick={() => props.openAdd('expense')}><Icon name="plus" size={16} /> Expense</button></div>
      </section>

      {props.totalCount === 0 ? (
        <FirstRun openAdd={props.openAdd} loadSampleData={props.loadSampleData} seeding={props.seeding} />
      ) : (
        <section className="panel">
          <div className="filters">
            <div className="search-wrap">
              <Icon name="search" size={16} />
              <input className="search-input" type="search" aria-label="Search transactions" value={props.search} onChange={e => props.setSearch(e.target.value)} placeholder="Search transactions" />
            </div>
            <select aria-label="Filter by type" value={props.filterType} onChange={e => props.setFilterType(e.target.value)}>
              <option value="all">All types</option><option value="income">Income</option><option value="expense">Expenses</option>
            </select>
            <select aria-label="Filter by category" value={props.filterCategory} onChange={e => props.setFilterCategory(e.target.value)}>
              <option value="all">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
            </select>
            <select aria-label="Sort transactions" value={props.sortBy} onChange={e => props.setSortBy(e.target.value)}>
              <option value="newest">Newest</option><option value="amount-high">Highest amount</option><option value="amount-low">Lowest amount</option><option value="name">Name A–Z</option>
            </select>
          </div>

          <p className="result-count" aria-live="polite">
            Showing {props.transactions.length} of {props.totalCount}
            {props.filtersActive && <button type="button" className="text-button" onClick={props.clearFilters}>Clear filters</button>}
          </p>

          {props.transactions.length === 0 ? (
            <Empty title="No matching transactions" text="Try a different search or clear your filters.">
              <button type="button" className="secondary-button" onClick={props.clearFilters}>Clear filters</button>
            </Empty>
          ) : (
            <TransactionList transactions={props.transactions} currency={props.currency} openEdit={props.openEdit} deleteTransaction={props.deleteTransaction} />
          )}
        </section>
      )}
    </div>
  )
}

function BudgetsPage({ currency, budgets, transactions, addOrUpdateBudget, deleteBudget }: { currency: string; budgets: Budget[]; transactions: Transaction[]; addOrUpdateBudget: (b?: Budget) => void; deleteBudget: (id: string) => void }) {
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0)
  const totalSpent = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="content">
      <section className="page-actions">
        <div><h2>Monthly limits</h2><p>Set spending limits by category.</p></div>
        <button type="button" className="primary-button" onClick={() => addOrUpdateBudget()}><Icon name="plus" size={16} /> Add / update budget</button>
      </section>
      <div className="summary-grid">
        <StatCard label="Budget total" value={money(totalBudget, currency)} note="All category limits" icon="wallet" />
        <StatCard label="Spent" value={money(totalSpent, currency)} note="All expenses" icon="arrow-down-right" />
      </div>
      <div className="budget-cards">
        {budgets.map(b => {
          const spent = transactions.filter(t => t.type === 'expense' && t.category.toLowerCase() === b.category.toLowerCase()).reduce((s, t) => s + t.amount, 0)
          const ratio = b.amount ? spent / b.amount : 0
          const percent = Math.min(ratio * 100, 100)
          const state = ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
          return (
            <article className={`budget-card ${state}`} key={b.id} style={catStyle(colorFor(b.category))}>
              <div className="panel-heading">
                <div><h3><i className="cat-dot" aria-hidden="true" />{b.category}</h3><p>{money(spent, currency)} spent</p></div>
                <div className="row-actions visible">
                  <button type="button" className="icon-action" onClick={() => addOrUpdateBudget(b)} aria-label={`Edit ${b.category} budget`} title="Edit"><Icon name="edit" size={16} /></button>
                  <button type="button" className="icon-action danger" onClick={() => deleteBudget(b.id)} aria-label={`Delete ${b.category} budget`} title="Delete"><Icon name="trash" size={16} /></button>
                </div>
              </div>
              <div className={`large-progress ${state}`} role="progressbar" aria-label={`${b.category} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="budget-meta">
                <span>
                  {state === 'over'
                    ? `${money(spent - b.amount, currency)} over`
                    : `${money(Math.max(b.amount - spent, 0), currency)} left`}
                </span>
                <strong>{Math.round(ratio * 100)}% of {money(b.amount, currency)}</strong>
              </div>
            </article>
          )
        })}
        {!budgets.length && (
          <Empty title="No budgets yet" text="Set a monthly limit for a category to see how much you have left.">
            <button type="button" className="primary-button" onClick={() => addOrUpdateBudget()}><Icon name="plus" size={16} /> Add a budget</button>
          </Empty>
        )}
      </div>
    </div>
  )
}

function AnalyticsPage({ currency, transactions, categoryTotals, maxCategoryTotal, openAdd }: { currency: string; transactions: Transaction[]; categoryTotals: { category: string; total: number }[]; maxCategoryTotal: number; openAdd: (type: TransactionType) => void }) {
  const expenses = transactions.filter(t => t.type === 'expense')
  const incomes = transactions.filter(t => t.type === 'income')
  const totalSpent = expenses.reduce((s, t) => s + t.amount, 0)
  const average = expenses.length ? totalSpent / expenses.length : 0
  const active = categoryTotals.filter(x => x.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div className="content">
      <section className="page-actions"><div><h2>Spending overview</h2><p>A simple view of your financial activity.</p></div></section>
      <div className="summary-grid">
        <StatCard label="Income entries" value={String(incomes.length)} note="Recorded income transactions" icon="arrow-up-right" positive />
        <StatCard label="Expense entries" value={String(expenses.length)} note="Recorded expenses" icon="arrow-down-right" />
        <StatCard label="Average expense" value={money(average, currency)} note="Per expense transaction" icon="chart" />
        <StatCard label="Largest expense" value={money(Math.max(...expenses.map(t => t.amount), 0), currency)} note="Single transaction" icon="target" />
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h3>Expense breakdown</h3><p>Compare categories</p></div></div>
        {active.length === 0 ? (
          <Empty title="No expenses yet" text="Start tracking your spending by adding your first expense.">
            <button type="button" className="primary-button" onClick={() => openAdd('expense')}><Icon name="plus" size={16} /> Add expense</button>
          </Empty>
        ) : (
          <div className="analytics-layout">
            <Donut segments={active} total={totalSpent} currency={currency} />
            <div className="analytics-bars">
              {active.map(item => (
                <div className="analytics-row" key={item.category} style={catStyle(colorFor(item.category))}>
                  <div><span><i className="cat-dot" aria-hidden="true" />{item.category}</span><strong>{money(item.total, currency)} <small>{Math.round((item.total / totalSpent) * 100)}%</small></strong></div>
                  <div className="bar-track"><i style={{ width: `${(item.total / maxCategoryTotal) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function GoalsPage({ currency, balance, goal, setGoal }: { currency: string; balance: number; goal: string; setGoal: (v: string) => void }) {
  const target = Number(goal) || 0
  const percent = target ? Math.min(Math.max((Math.max(balance, 0) / target) * 100, 0), 100) : 0
  const remaining = Math.max(target - Math.max(balance, 0), 0)

  return (
    <div className="content">
      <section className="page-actions"><div><h2>Savings goal</h2><p>Track progress toward a target.</p></div></section>
      <section className="goal-card">
        <div className="goal-icon"><Icon name="target" size={26} /></div>
        <div className="goal-copy"><span>Current balance</span><strong>{money(Math.max(balance, 0), currency)}</strong><p>Goal: {money(target, currency)}</p>{target > 0 && remaining > 0 && <p>{money(remaining, currency)} to go</p>}</div>
        <div className="goal-percent">{Math.round(percent)}%</div>
      </section>
      <section className="panel">
        <h3>Set your target</h3>
        <p className="muted">Progress is calculated from your current balance. Your target is saved on this device.</p>
        <div className="goal-form">
          <label className="sr-only" htmlFor="goal-input">Savings target</label>
          <input id="goal-input" type="number" inputMode="decimal" min="0" value={goal} onChange={e => setGoal(e.target.value)} />
          <span>{currency}</span>
        </div>
        <div className="large-progress" role="progressbar" aria-label="Savings goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i style={{ width: `${percent}%` }} /></div>
      </section>
    </div>
  )
}

function SettingsPage({ displayName, setDisplayName, currency, setCurrency, theme, setTheme, exportCSV, clearAllData, resetApp }: { displayName: string; setDisplayName: (v: string) => void; currency: string; setCurrency: (v: string) => void; theme: string; setTheme: (v: string) => void; exportCSV: () => void; clearAllData: () => void; resetApp: () => void }) {
  return (
    <div className="content">
      <section className="page-actions"><div><h2>Your preferences</h2><p>Customize your SpendWise experience.</p></div></section>
      <div className="settings-grid">
        <section className="panel settings-card">
          <h3>Profile</h3>
          <div className="field">
            <label htmlFor="set-name">Display name</label>
            <input id="set-name" value={displayName} maxLength={40} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="set-currency">Currency</label>
            <select id="set-currency" value={currency} onChange={e => setCurrency(e.target.value)}>
              <option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound</option>
            </select>
          </div>
          <div className="field">
            <span className="label" id="set-theme-label">Theme</span>
            <div className="type-switch" role="group" aria-labelledby="set-theme-label">
              <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Icon name="sun" size={16} /> Light</button>
              <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Icon name="moon" size={16} /> Dark</button>
            </div>
          </div>
        </section>
        <section className="panel settings-card">
          <h3>Data</h3>
          <p className="muted">Transactions and budgets are stored in your account and are only visible to you. Display name, currency and savings goal are saved on this device.</p>
          <button type="button" className="secondary-button full" onClick={exportCSV}><Icon name="download" size={16} /> Export transactions CSV</button>
          <button type="button" className="danger-button full" onClick={clearAllData}>Reset savings goal</button>
          <button type="button" className="secondary-button full" onClick={resetApp}>Reset preferences</button>
        </section>
      </div>
    </div>
  )
}

export default App