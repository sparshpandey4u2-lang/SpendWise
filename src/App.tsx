import { useEffect, useMemo, useState } from 'react'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { createClerkSupabaseClient } from './supabase'
import './App.css'

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

type Goal = {
  id: string
  name: string
  target: number
  saved: number
}

type UserSettings = {
  displayName: string
  currency: string
  theme: string
}

const categories = ['Food', 'Entertainment', 'Transport', 'Shopping', 'Bills', 'Education', 'Health', 'Other']

const initialTransactions: Transaction[] = [
  { id: 'demo-1', name: 'Grocery Shopping', category: 'Food', date: 'Today', amount: 1250, type: 'expense' },
  { id: 'demo-2', name: 'Monthly Allowance', category: 'Income', date: 'Yesterday', amount: 5000, type: 'income' },
  { id: 'demo-3', name: 'Movie Tickets', category: 'Entertainment', date: 'Sep 17', amount: 600, type: 'expense' },
  { id: 'demo-4', name: 'Uber', category: 'Transport', date: 'Sep 16', amount: 320, type: 'expense' },
]

const initialBudgets: Budget[] = [
  { id: 'demo-budget-1', category: 'Food', amount: 3000 },
  { id: 'demo-budget-2', category: 'Entertainment', amount: 2000 },
  { id: 'demo-budget-3', category: 'Transport', amount: 1500 },
  { id: 'demo-budget-4', category: 'Shopping', amount: 2000 },
]

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function todayLabel() {
  return 'Today'
}

function App() {
  const clerk = useClerk()
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()

  const supabase = useMemo(
    () => createClerkSupabaseClient(getToken),
    [getToken]
  )

  const [page, setPage] = useState('Dashboard')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])

  const [goal, setGoal] = useState<Goal | null>(null)
  const [goalTarget, setGoalTarget] = useState('10000')
  const [goalLoaded, setGoalLoaded] = useState(false)
  const [theme, setTheme] = useState('light')
  const [currency, setCurrency] = useState('INR')
  const [displayName, setDisplayName] = useState('Master')
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState<TransactionType>('expense')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Food')
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [sortBy, setSortBy] = useState('newest')

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setTransactions([])
      return
    }

    const loadTransactions = async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to load transactions:', error)
        return
      }

      setTransactions((data ?? []).map(row => ({
        id: row.id,
        name: row.title,
        category: row.category,
        date: row.date,
        amount: Number(row.amount),
        type: row.type as TransactionType,
      })))
    }

    loadTransactions()
  }, [isLoaded, isSignedIn, userId, supabase])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setBudgets([])
      return
    }

    const loadBudgets = async () => {
      const { data, error } = await supabase
        .from('budgets')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to load budgets:', error)
        return
      }

      setBudgets((data ?? []).map(row => ({
        id: row.id,
        category: row.category,
        amount: Number(row.amount),
      })))
    }

    loadBudgets()
  }, [isLoaded, isSignedIn, userId, supabase])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setGoal(null)
      setGoalTarget('10000')
      setGoalLoaded(false)
      return
    }

    const loadGoal = async () => {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('Failed to load goal:', error)
        return
      }

      if (!data) {
        const { data: created, error: createError } = await supabase
          .from('goals')
          .insert({ user_id: userId, name: 'Savings Goal', target: 10000, saved: 0 })
          .select()
          .single()

        if (createError) {
          console.error('Failed to create goal:', createError)
          return
        }

        setGoal({ id: created.id, name: created.name, target: Number(created.target), saved: Number(created.saved) })
        setGoalTarget(String(created.target))
        setGoalLoaded(true)
        return
      }

      setGoal({ id: data.id, name: data.name, target: Number(data.target), saved: Number(data.saved) })
      setGoalTarget(String(data.target))
      setGoalLoaded(true)
    }

    loadGoal()
  }, [isLoaded, isSignedIn, userId, supabase])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setSettingsLoaded(false)
      return
    }

    const loadSettings = async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) {
        console.error('Failed to load settings:', error)
        return
      }

      if (!data) {
        const defaults: UserSettings = { displayName: 'Master', currency: 'INR', theme: 'light' }
        const { error: createError } = await supabase
          .from('user_settings')
          .insert({
            user_id: userId,
            display_name: defaults.displayName,
            currency: defaults.currency,
            theme: defaults.theme,
          })

        if (createError) {
          console.error('Failed to create settings:', createError)
          return
        }

        setDisplayName(defaults.displayName)
        setCurrency(defaults.currency)
        setTheme(defaults.theme)
      } else {
        setDisplayName(data.display_name || 'Master')
        setCurrency(data.currency || 'INR')
        setTheme(data.theme || 'light')
      }

      setSettingsLoaded(true)
    }

    loadSettings()
  }, [isLoaded, isSignedIn, userId, supabase])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!settingsLoaded || !userId || !isSignedIn) return

    const timer = window.setTimeout(async () => {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          display_name: displayName.trim() || 'Master',
          currency,
          theme,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

      if (error) console.error('Failed to save settings:', error)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [displayName, currency, theme, settingsLoaded, userId, isSignedIn, supabase])


  const totalIncome = useMemo(
    () => transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  )

  const totalExpenses = useMemo(
    () => transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  )

  const balance = totalIncome - totalExpenses

  useEffect(() => {
    if (!goalLoaded || !isSignedIn || !userId) return
    const target = Number(goalTarget)
    if (!Number.isFinite(target) || target < 0) return

    const saved = Math.max(balance, 0)

    const timer = window.setTimeout(async () => {
      if (!goal) {
        const { data, error } = await supabase
          .from('goals')
          .insert({ user_id: userId, name: 'Savings Goal', target, saved })
          .select()
          .single()

        if (error) {
          console.error('Failed to create goal:', error)
          return
        }

        setGoal({ id: data.id, name: data.name, target: Number(data.target), saved: Number(data.saved) })
        return
      }

      if (Math.abs(goal.target - target) < 0.001 && Math.abs(goal.saved - saved) < 0.001) return

      const { data, error } = await supabase
        .from('goals')
        .update({ target, saved, name: goal.name })
        .eq('id', goal.id)
        .select()
        .single()

      if (error) {
        console.error('Failed to save goal:', error)
        return
      }

      setGoal({ id: data.id, name: data.name, target: Number(data.target), saved: Number(data.saved) })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [goal, goalTarget, balance, goalLoaded, isSignedIn, userId, supabase])

  const categoryTotals = useMemo(() => {
    return categories.map(cat => ({
      category: cat,
      total: transactions
        .filter(t => t.type === 'expense' && t.category === cat)
        .reduce((sum, t) => sum + t.amount, 0),
    }))
  }, [transactions])

  const maxCategoryTotal = Math.max(...categoryTotals.map(x => x.total), 1)

  const filteredTransactions = useMemo(() => {
    const result = transactions.filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase())
      const matchesType = filterType === 'all' || t.type === filterType
      const matchesCategory = filterCategory === 'all' || t.category === filterCategory
      return matchesSearch && matchesType && matchesCategory
    })

    return [...result].sort((a, b) => {
      if (sortBy === 'amount-high') return b.amount - a.amount
      if (sortBy === 'amount-low') return a.amount - b.amount
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return transactions.indexOf(b) - transactions.indexOf(a)
    })
  }, [transactions, search, filterType, filterCategory, sortBy])

  const budgetTotal = budgets.reduce((sum, b) => sum + b.amount, 0)
  const budgetSpent = totalExpenses
  const budgetPercent = budgetTotal ? Math.min((budgetSpent / budgetTotal) * 100, 100) : 0

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

  const saveTransaction = async () => {
    const numericAmount = Number(amount)

    if (!name.trim()) {
      setError('Please enter a name.')
      return
    }

    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid positive amount.')
      return
    }

    if (!isLoaded || !isSignedIn || !userId) {
      setError('Please sign in first.')
      return
    }

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
        .select()
        .single()

      if (error) {
        console.error('Failed to update transaction:', error)
        setError('Could not save transaction.')
        return
      }

      setTransactions(current => current.map(t =>
        t.id === editingId
          ? {
              id: data.id,
              name: data.title,
              category: data.category,
              date: data.date,
              amount: Number(data.amount),
              type: data.type as TransactionType,
            }
          : t
      ))
    } else {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          title: name.trim(),
          amount: numericAmount,
          type: modalType,
          category: modalType === 'income' ? 'Income' : category,
          date: todayLabel(),
        })
        .select()
        .single()

      if (error) {
        console.error('Failed to add transaction:', error)
        setError('Could not add transaction.')
        return
      }

      setTransactions(current => [{
        id: data.id,
        name: data.title,
        category: data.category,
        date: data.date,
        amount: Number(data.amount),
        type: data.type as TransactionType,
      }, ...current])
    }

    setShowModal(false)
  }

  const deleteTransaction = async (id: string) => {
    if (!window.confirm('Delete this transaction?')) return

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Failed to delete transaction:', error)
      window.alert('Could not delete transaction.')
      return
    }

    setTransactions(current => current.filter(t => t.id !== id))
  }

  const addOrUpdateBudget = async () => {
    const catInput = window.prompt('Budget category:', 'Food')
    if (!catInput?.trim()) return
    const cat = catInput.trim()

    const value = Number(window.prompt(`Monthly budget for ${cat}:`, '2000'))
    if (!Number.isFinite(value) || value <= 0) return

    if (!isLoaded || !isSignedIn || !userId) {
      window.alert('Please sign in first.')
      return
    }

    const existing = budgets.find(
      b => b.category.toLowerCase() === cat.toLowerCase()
    )

    if (existing) {
      const { data, error } = await supabase
        .from('budgets')
        .update({ amount: value, category: existing.category })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('Failed to update budget:', error)
        window.alert('Could not update budget.')
        return
      }

      setBudgets(current => current.map(b =>
        b.id === existing.id
          ? { id: data.id, category: data.category, amount: Number(data.amount) }
          : b
      ))
      return
    }

    const { data, error } = await supabase
      .from('budgets')
      .insert({ user_id: userId, category: cat, amount: value })
      .select()
      .single()

    if (error) {
      console.error('Failed to add budget:', error)
      window.alert('Could not add budget.')
      return
    }

    setBudgets(current => [...current, {
      id: data.id,
      category: data.category,
      amount: Number(data.amount),
    }])
  }

  const deleteBudget = async (id: string) => {
    const budget = budgets.find(b => b.id === id)
    if (!budget) return
    if (!window.confirm(`Delete the ${budget.category} budget?`)) return

    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Failed to delete budget:', error)
      window.alert('Could not delete budget.')
      return
    }

    setBudgets(current => current.filter(b => b.id !== id))
  }

  const exportCSV = () => {
    const rows = [
      ['Name', 'Type', 'Category', 'Amount', 'Date'],
      ...transactions.map(t => [t.name, t.type, t.category, String(t.amount), t.date]),
    ]
    const csv = rows
      .map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'spendwise-transactions.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const clearAllData = async () => {
    if (!isLoaded || !isSignedIn || !userId) {
      window.alert('Please sign in first.')
      return
    }

    if (!window.confirm('Delete all your transactions, budgets and savings goal? This cannot be undone.')) return

    const [transactionsResult, budgetsResult, goalsResult] = await Promise.all([
      supabase.from('transactions').delete().eq('user_id', userId),
      supabase.from('budgets').delete().eq('user_id', userId),
      supabase.from('goals').delete().eq('user_id', userId),
    ])

    const firstError = transactionsResult.error || budgetsResult.error || goalsResult.error
    if (firstError) {
      console.error('Failed to clear data:', firstError)
      window.alert('Could not clear all data. Please try again.')
      return
    }

    setTransactions([])
    setBudgets([])

    const { data: newGoal, error: goalError } = await supabase
      .from('goals')
      .insert({ user_id: userId, name: 'Savings Goal', target: 10000, saved: 0 })
      .select()
      .single()

    if (goalError) {
      console.error('Failed to restore an empty goal:', goalError)
      setGoal(null)
      setGoalTarget('10000')
    } else {
      setGoal({ id: newGoal.id, name: newGoal.name, target: Number(newGoal.target), saved: Number(newGoal.saved) })
      setGoalTarget('10000')
    }

    window.alert('Transactions and budgets have been cleared. Your empty savings goal was reset.')
  }

  const resetApp = async () => {
    if (!isLoaded || !isSignedIn || !userId) {
      window.alert('Please sign in first.')
      return
    }

    if (!window.confirm('Reset your SpendWise account to clean demo data?')) return

    const [deleteTransactions, deleteBudgets, deleteGoals] = await Promise.all([
      supabase.from('transactions').delete().eq('user_id', userId),
      supabase.from('budgets').delete().eq('user_id', userId),
      supabase.from('goals').delete().eq('user_id', userId),
    ])

    const deleteError = deleteTransactions.error || deleteBudgets.error || deleteGoals.error
    if (deleteError) {
      console.error('Failed to reset app:', deleteError)
      window.alert('Could not reset the app. Please try again.')
      return
    }

    const demoTransactions = initialTransactions.map(t => ({
      user_id: userId, title: t.name, amount: t.amount, type: t.type, category: t.category, date: t.date,
    }))
    const demoBudgets = initialBudgets.map(b => ({
      user_id: userId, category: b.category, amount: b.amount,
    }))

    const [transactionInsert, budgetInsert, goalInsert] = await Promise.all([
      supabase.from('transactions').insert(demoTransactions),
      supabase.from('budgets').insert(demoBudgets),
      supabase.from('goals').insert({ user_id: userId, name: 'Savings Goal', target: 10000, saved: 0 }).select().single(),
    ])

    const insertError = transactionInsert.error || budgetInsert.error || goalInsert.error
    if (insertError) {
      console.error('Failed to restore demo data:', insertError)
      window.alert('The reset did not finish completely. Refresh and check your data.')
      return
    }

    setTransactions((transactionInsert.data ?? []).map(row => ({
      id: row.id, name: row.title, category: row.category, date: row.date, amount: Number(row.amount), type: row.type as TransactionType,
    })))
    setBudgets((budgetInsert.data ?? []).map(row => ({
      id: row.id, category: row.category, amount: Number(row.amount),
    })))
    if (goalInsert.data) {
      setGoal({ id: goalInsert.data.id, name: goalInsert.data.name, target: Number(goalInsert.data.target), saved: Number(goalInsert.data.saved) })
    }
    setGoalTarget('10000')
    setDisplayName('Master')
    setTheme('light')
    setCurrency('INR')
    window.alert('SpendWise has been reset to the demo data.')
  }

  const navItems = [
    ['Dashboard', '⌂'],
    ['Transactions', '↔'],
    ['Budgets', '▣'],
    ['Analytics', '◔'],
    ['Goals', '◎'],
    ['Settings', '⚙'],
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SpendWise</strong>
            <span>Personal Finance</span>
          </div>
        </div>

        <nav>
          {navItems.map(([item, icon]) => (
            <button
              key={item}
              className={page === item ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item)}
            >
              <span>{icon}</span>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="mini-goal">
            <span>Monthly budget</span>
            <strong>{money(budgetSpent, currency)} / {money(budgetTotal, currency)}</strong>
            <div className="progress"><i style={{ width: `${budgetPercent}%` }} /></div>
          </div>
          <button className="export-button" onClick={exportCSV}>↓ Export CSV</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Personal finance</p>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? '☾' : '☀'}
            </button>

            <div className="auth-controls">
              {!isLoaded ? (
                <span className="auth-loading">Loading...</span>
              ) : isSignedIn ? (
                <UserButton />
              ) : (
                <>
                  <button type="button" className="auth-button secondary" onClick={() => clerk.openSignIn({})}>Sign In</button>
                  <button type="button" className="auth-button primary" onClick={() => clerk.openSignUp({})}>Sign Up</button>
                </>
              )}
            </div>

            {!isSignedIn && (
              <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
            )}
          </div>
        </header>

        {page === 'Dashboard' && (
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
          />
        )}

        {page === 'Transactions' && (
          <TransactionsPage
            currency={currency}
            transactions={filteredTransactions}
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
          />
        )}

        {page === 'Budgets' && (
          <BudgetsPage
            currency={currency}
            budgets={budgets}
            transactions={transactions}
            addOrUpdateBudget={addOrUpdateBudget}
            deleteBudget={deleteBudget}
          />
        )}

        {page === 'Analytics' && (
          <AnalyticsPage
            currency={currency}
            transactions={transactions}
            categoryTotals={categoryTotals}
            maxCategoryTotal={maxCategoryTotal}
          />
        )}

        {page === 'Goals' && (
          <GoalsPage
            currency={currency}
            balance={balance}
            goal={goal}
            goalTarget={goalTarget}
            setGoalTarget={setGoalTarget}
          />
        )}

        {page === 'Settings' && (
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
        )}
      </main>

      {showModal && (
        <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}>
          <div className="modal" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{editingId !== null ? 'Edit transaction' : 'New transaction'}</p>
                <h2>{editingId !== null ? 'Edit transaction' : `Add ${modalType}`}</h2>
              </div>
              <button className="close-button" onClick={() => setShowModal(false)}>×</button>
            </div>

            <div className="type-switch">
              <button className={modalType === 'expense' ? 'selected' : ''} onClick={() => setModalType('expense')}>Expense</button>
              <button className={modalType === 'income' ? 'selected income' : ''} onClick={() => setModalType('income')}>Income</button>
            </div>

            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={modalType === 'expense' ? 'e.g. Groceries' : 'e.g. Allowance'} />

            <label>Amount</label>
            <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />

            {modalType === 'expense' && (
              <>
                <label>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)}>
                  {categories.map(cat => <option key={cat}>{cat}</option>)}
                </select>
              </>
            )}

            {error && <div className="error">{error}</div>}

            <button className="primary-button full" onClick={saveTransaction}>
              {editingId !== null ? 'Save changes' : `Add ${modalType}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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
}) {
  const {
    displayName, currency, transactions, totalIncome, totalExpenses, balance,
    budgetTotal, budgetSpent, budgetPercent, categoryTotals, maxCategoryTotal,
    openAdd, openEdit, deleteTransaction, goTransactions
  } = props

  return (
    <div className="content">
      <section className="welcome">
        <div>
          <h2>Good day, {displayName} 👋</h2>
          <p>Here’s what your money is doing right now.</p>
        </div>
        <div className="action-row">
          <button className="secondary-button" onClick={() => openAdd('income')}>＋ Add income</button>
          <button className="primary-button" onClick={() => openAdd('expense')}>＋ Add expense</button>
        </div>
      </section>

      <section className="summary-grid">
        <StatCard label="Current balance" value={money(balance, currency)} note={balance >= 0 ? 'Available balance' : 'Over your income'} icon="₹" />
        <StatCard label="Total income" value={money(totalIncome, currency)} note="All recorded income" icon="↗" positive />
        <StatCard label="Total expenses" value={money(totalExpenses, currency)} note="All recorded spending" icon="↘" />
        <StatCard label="Budget used" value={`${Math.round(budgetPercent)}%`} note={`${money(budgetSpent, currency)} spent`} icon="%" />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-heading">
            <div><h3>Recent transactions</h3><p>Your latest activity</p></div>
            <button className="text-button" onClick={goTransactions}>View all →</button>
          </div>
          <TransactionList transactions={transactions.slice(0, 6)} currency={currency} openEdit={openEdit} deleteTransaction={deleteTransaction} />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div><h3>Spending by category</h3><p>Where your money goes</p></div>
          </div>
          <div className="category-bars">
            {categoryTotals.filter(x => x.total > 0).length === 0 && <Empty text="No expenses yet." />}
            {categoryTotals.filter(x => x.total > 0).map(item => (
              <div className="bar-row" key={item.category}>
                <div className="bar-label"><span>{item.category}</span><strong>{money(item.total, currency)}</strong></div>
                <div className="bar-track"><i style={{ width: `${(item.total / maxCategoryTotal) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel budget-panel">
        <div className="panel-heading">
          <div><h3>Monthly budget</h3><p>Track your overall spending limit</p></div>
          <strong>{money(budgetSpent, currency)} / {money(budgetTotal, currency)}</strong>
        </div>
        <div className="large-progress"><i style={{ width: `${budgetPercent}%` }} /></div>
        <p className="muted">{budgetPercent >= 100 ? 'Budget reached.' : `${money(Math.max(budgetTotal - budgetSpent, 0), currency)} remaining this month.`}</p>
      </section>

      <section className="quick-actions">
        <button onClick={() => openAdd('expense')}><span>＋</span><div><strong>Add expense</strong><small>Record spending</small></div></button>
        <button onClick={() => openAdd('income')}><span>↗</span><div><strong>Add income</strong><small>Record money received</small></div></button>
        <button onClick={goTransactions}><span>↔</span><div><strong>Manage transactions</strong><small>Search and edit</small></div></button>
      </section>
    </div>
  )
}

function StatCard({ label, value, note, icon, positive = false }: { label: string; value: string; note: string; icon: string; positive?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><b className={positive ? 'positive-icon' : ''}>{icon}</b></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  )
}

function TransactionList({ transactions, currency, openEdit, deleteTransaction }: { transactions: Transaction[]; currency: string; openEdit: (t: Transaction) => void; deleteTransaction: (id: string) => void }) {
  if (!transactions.length) return <Empty text="No transactions yet." />
  return (
    <div className="transaction-list">
      {transactions.map(t => (
        <div className="transaction" key={t.id}>
          <div className={`transaction-icon ${t.type}`}>{t.type === 'income' ? '↗' : '−'}</div>
          <div className="transaction-info"><strong>{t.name}</strong><span>{t.category} · {t.date}</span></div>
          <strong className={t.type === 'income' ? 'amount income' : 'amount'}>{t.type === 'income' ? '+' : '-'}{money(t.amount, currency)}</strong>
          <button className="tiny-button" onClick={() => openEdit(t)}>Edit</button>
          <button className="tiny-button danger" onClick={() => deleteTransaction(t.id)}>Delete</button>
        </div>
      ))}
    </div>
  )
}

function TransactionsPage(props: {
  currency: string
  transactions: Transaction[]
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
}) {
  return (
    <div className="content">
      <section className="page-actions">
        <div><h2>All transactions</h2><p>Search, filter, sort and manage your money.</p></div>
        <div className="action-row"><button className="secondary-button" onClick={() => props.openAdd('income')}>＋ Income</button><button className="primary-button" onClick={() => props.openAdd('expense')}>＋ Expense</button></div>
      </section>

      <section className="panel">
        <div className="filters">
          <input className="search-input" value={props.search} onChange={e => props.setSearch(e.target.value)} placeholder="Search transactions..." />
          <select value={props.filterType} onChange={e => props.setFilterType(e.target.value)}>
            <option value="all">All types</option><option value="income">Income</option><option value="expense">Expenses</option>
          </select>
          <select value={props.filterCategory} onChange={e => props.setFilterCategory(e.target.value)}>
            <option value="all">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={props.sortBy} onChange={e => props.setSortBy(e.target.value)}>
            <option value="newest">Newest</option><option value="amount-high">Highest amount</option><option value="amount-low">Lowest amount</option><option value="name">Name A–Z</option>
          </select>
        </div>
        <TransactionList transactions={props.transactions} currency={props.currency} openEdit={props.openEdit} deleteTransaction={props.deleteTransaction} />
      </section>
    </div>
  )
}

function BudgetsPage({ currency, budgets, transactions, addOrUpdateBudget, deleteBudget }: { currency: string; budgets: Budget[]; transactions: Transaction[]; addOrUpdateBudget: () => void; deleteBudget: (id: string) => void }) {
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0)
  const totalSpent = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="content">
      <section className="page-actions">
        <div><h2>Budgets</h2><p>Set spending limits by category.</p></div>
        <button className="primary-button" onClick={addOrUpdateBudget}>＋ Add / update budget</button>
      </section>
      <div className="summary-grid">
        <StatCard label="Budget total" value={money(totalBudget, currency)} note="All category limits" icon="▣" />
        <StatCard label="Spent" value={money(totalSpent, currency)} note="All expenses" icon="↘" />
      </div>
      <div className="budget-cards">
        {budgets.map(b => {
          const spent = transactions.filter(t => t.type === 'expense' && t.category.toLowerCase() === b.category.toLowerCase()).reduce((s, t) => s + t.amount, 0)
          const percent = b.amount ? Math.min((spent / b.amount) * 100, 100) : 0
          return (
            <div className="budget-card" key={b.category}>
              <div className="panel-heading"><div><h3>{b.category}</h3><p>{money(spent, currency)} spent</p></div><button className="tiny-button danger" onClick={() => deleteBudget(b.id)}>Delete</button></div>
              <div className="large-progress"><i style={{ width: `${percent}%` }} /></div>
              <div className="budget-meta"><span>{Math.round(percent)}% used</span><strong>{money(b.amount, currency)}</strong></div>
            </div>
          )
        })}
        {!budgets.length && <Empty text="No budgets yet. Add one to start tracking." />}
      </div>
    </div>
  )
}

function AnalyticsPage({ currency, transactions, categoryTotals, maxCategoryTotal }: { currency: string; transactions: Transaction[]; categoryTotals: { category: string; total: number }[]; maxCategoryTotal: number }) {
  const expenses = transactions.filter(t => t.type === 'expense')
  const incomes = transactions.filter(t => t.type === 'income')
  const average = expenses.length ? expenses.reduce((s, t) => s + t.amount, 0) / expenses.length : 0

  return (
    <div className="content">
      <section className="page-actions"><div><h2>Analytics</h2><p>A simple view of your financial activity.</p></div></section>
      <div className="summary-grid">
        <StatCard label="Income entries" value={String(incomes.length)} note="Recorded income transactions" icon="↗" positive />
        <StatCard label="Expense entries" value={String(expenses.length)} note="Recorded expenses" icon="↘" />
        <StatCard label="Average expense" value={money(average, currency)} note="Per expense transaction" icon="≈" />
        <StatCard label="Largest expense" value={money(Math.max(...expenses.map(t => t.amount), 0), currency)} note="Single transaction" icon="↑" />
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h3>Expense breakdown</h3><p>Compare categories</p></div></div>
        <div className="analytics-bars">
          {categoryTotals.map(item => (
            <div className="analytics-row" key={item.category}>
              <div><span>{item.category}</span><strong>{money(item.total, currency)}</strong></div>
              <div className="bar-track"><i style={{ width: `${(item.total / maxCategoryTotal) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function GoalsPage({ currency, balance, goal, goalTarget, setGoalTarget }: { currency: string; balance: number; goal: Goal | null; goalTarget: string; setGoalTarget: (v: string) => void }) {
  const target = Number(goalTarget) || 0
  const saved = Math.max(balance, 0)
  const percent = target ? Math.min(Math.max((saved / target) * 100, 0), 100) : 0

  return (
    <div className="content">
      <section className="page-actions"><div><h2>Savings goal</h2><p>Track progress toward a target saved securely in your account.</p></div></section>
      <section className="goal-card">
        <div className="goal-icon">◎</div>
        <div className="goal-copy"><span>Current balance</span><strong>{money(saved, currency)}</strong><p>{goal?.name || 'Savings Goal'}: {money(target, currency)}</p></div>
        <div className="goal-percent">{Math.round(percent)}%</div>
      </section>
      <section className="panel">
        <h3>Set your target</h3>
        <p className="muted">Your goal target is stored in Supabase and linked to your account.</p>
        <div className="goal-form"><input type="number" min="0" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} /><span>{currency}</span></div>
        <div className="large-progress"><i style={{ width: `${percent}%` }} /></div>
      </section>
    </div>
  )
}

function SettingsPage({ displayName, setDisplayName, currency, setCurrency, theme, setTheme, exportCSV, clearAllData, resetApp }: { displayName: string; setDisplayName: (v: string) => void; currency: string; setCurrency: (v: string) => void; theme: string; setTheme: (v: string) => void; exportCSV: () => void; clearAllData: () => void; resetApp: () => void }) {
  return (
    <div className="content">
      <section className="page-actions"><div><h2>Settings</h2><p>Customize your SpendWise experience.</p></div></section>
      <div className="settings-grid">
        <section className="panel settings-card">
          <h3>Profile</h3>
          <label>Display name</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} />
          <label>Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound</option>
          </select>
          <label>Theme</label>
          <select value={theme} onChange={e => setTheme(e.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select>
        </section>
        <section className="panel settings-card">
          <h3>Data</h3>
          <p className="muted">Your transactions, budgets, savings goal and preferences are securely stored in your Supabase account.</p>
          <button className="secondary-button full" onClick={exportCSV}>↓ Export transactions CSV</button>
          <button className="danger-button full" onClick={clearAllData}>Clear all data</button>
          <button className="secondary-button full" onClick={resetApp}>Reset demo data</button>
        </section>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}

export default App
