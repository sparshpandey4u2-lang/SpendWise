import { useEffect, useMemo, useState } from 'react'
import './App.css'

type TransactionType = 'income' | 'expense'

type Transaction = {
  id: number
  name: string
  category: string
  date: string
  amount: number
  type: TransactionType
}

type Budget = {
  category: string
  amount: number
}

const STORAGE_KEY = 'spendwise-transactions'
const BUDGET_KEY = 'spendwise-budgets'
const GOAL_KEY = 'spendwise-goal'
const THEME_KEY = 'spendwise-theme'
const CURRENCY_KEY = 'spendwise-currency'

const categories = ['Food', 'Entertainment', 'Transport', 'Shopping', 'Bills', 'Education', 'Health', 'Other']

const initialTransactions: Transaction[] = [
  { id: 1, name: 'Grocery Shopping', category: 'Food', date: 'Today', amount: 1250, type: 'expense' },
  { id: 2, name: 'Monthly Allowance', category: 'Income', date: 'Yesterday', amount: 5000, type: 'income' },
  { id: 3, name: 'Movie Tickets', category: 'Entertainment', date: 'Sep 17', amount: 600, type: 'expense' },
  { id: 4, name: 'Uber', category: 'Transport', date: 'Sep 16', amount: 320, type: 'expense' },
]

const initialBudgets: Budget[] = [
  { category: 'Food', amount: 3000 },
  { category: 'Entertainment', amount: 2000 },
  { category: 'Transport', amount: 1500 },
  { category: 'Shopping', amount: 2000 },
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
  const [page, setPage] = useState('Dashboard')
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialTransactions
    try {
      return JSON.parse(saved)
    } catch {
      return initialTransactions
    }
  })

  const [budgets, setBudgets] = useState<Budget[]>(() => {
    const saved = localStorage.getItem(BUDGET_KEY)
    if (!saved) return initialBudgets
    try {
      return JSON.parse(saved)
    } catch {
      return initialBudgets
    }
  })

  const [goal, setGoal] = useState(() => localStorage.getItem(GOAL_KEY) || '10000')
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light')
  const [currency, setCurrency] = useState(() => localStorage.getItem(CURRENCY_KEY) || 'INR')
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('spendwise-name') || 'Master')

  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState<TransactionType>('expense')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Food')
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [sortBy, setSortBy] = useState('newest')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions))
  }, [transactions])

  useEffect(() => {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budgets))
  }, [budgets])

  useEffect(() => {
    localStorage.setItem(GOAL_KEY, goal)
  }, [goal])

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(CURRENCY_KEY, currency)
  }, [currency])

  useEffect(() => {
    localStorage.setItem('spendwise-name', displayName)
  }, [displayName])

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
      return b.id - a.id
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

  const saveTransaction = () => {
    const numericAmount = Number(amount)

    if (!name.trim()) {
      setError('Please enter a name.')
      return
    }

    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid positive amount.')
      return
    }

    if (editingId !== null) {
      setTransactions(current =>
        current.map(t =>
          t.id === editingId
            ? {
                ...t,
                name: name.trim(),
                amount: numericAmount,
                category: modalType === 'income' ? 'Income' : category,
              }
            : t
        )
      )
    } else {
      setTransactions(current => [
        {
          id: Date.now(),
          name: name.trim(),
          category: modalType === 'income' ? 'Income' : category,
          date: todayLabel(),
          amount: numericAmount,
          type: modalType,
        },
        ...current,
      ])
    }

    setShowModal(false)
  }

  const deleteTransaction = (id: number) => {
    if (window.confirm('Delete this transaction?')) {
      setTransactions(current => current.filter(t => t.id !== id))
    }
  }

  const addOrUpdateBudget = () => {
    const cat = prompt('Budget category:', 'Food')
    if (!cat) return
    const value = Number(prompt(`Monthly budget for ${cat}:`, '2000'))
    if (!Number.isFinite(value) || value <= 0) return

    setBudgets(current => {
      const exists = current.some(b => b.category.toLowerCase() === cat.toLowerCase())
      if (exists) {
        return current.map(b =>
          b.category.toLowerCase() === cat.toLowerCase() ? { ...b, amount: value } : b
        )
      }
      return [...current, { category: cat, amount: value }]
    })
  }

  const deleteBudget = (cat: string) => {
    setBudgets(current => current.filter(b => b.category !== cat))
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

  const clearAllData = () => {
    if (!window.confirm('This will delete all local SpendWise data. Continue?')) return
    setTransactions([])
    setBudgets([])
    setGoal('10000')
  }

  const resetApp = () => {
    if (!window.confirm('Reset SpendWise to the original demo data?')) return
    setTransactions(initialTransactions)
    setBudgets(initialBudgets)
    setGoal('10000')
    setDisplayName('Master')
    setTheme('light')
    setCurrency('INR')
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
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? '☾' : '☀'}
            </button>
            <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
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
            setGoal={setGoal}
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
                <p className="eyebrow">{editingId ? 'Edit transaction' : 'New transaction'}</p>
                <h2>{editingId ? 'Edit transaction' : `Add ${modalType}`}</h2>
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
              {editingId ? 'Save changes' : `Add ${modalType}`}
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
  deleteTransaction: (id: number) => void
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

function TransactionList({ transactions, currency, openEdit, deleteTransaction }: { transactions: Transaction[]; currency: string; openEdit: (t: Transaction) => void; deleteTransaction: (id: number) => void }) {
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
  deleteTransaction: (id: number) => void
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

function BudgetsPage({ currency, budgets, transactions, addOrUpdateBudget, deleteBudget }: { currency: string; budgets: Budget[]; transactions: Transaction[]; addOrUpdateBudget: () => void; deleteBudget: (c: string) => void }) {
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
              <div className="panel-heading"><div><h3>{b.category}</h3><p>{money(spent, currency)} spent</p></div><button className="tiny-button danger" onClick={() => deleteBudget(b.category)}>Delete</button></div>
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

function GoalsPage({ currency, balance, goal, setGoal }: { currency: string; balance: number; goal: string; setGoal: (v: string) => void }) {
  const target = Number(goal) || 0
  const percent = target ? Math.min(Math.max((Math.max(balance, 0) / target) * 100, 0), 100) : 0

  return (
    <div className="content">
      <section className="page-actions"><div><h2>Savings goal</h2><p>Track progress toward a target.</p></div></section>
      <section className="goal-card">
        <div className="goal-icon">◎</div>
        <div className="goal-copy"><span>Current balance</span><strong>{money(Math.max(balance, 0), currency)}</strong><p>Goal: {money(target, currency)}</p></div>
        <div className="goal-percent">{Math.round(percent)}%</div>
      </section>
      <section className="panel">
        <h3>Set your target</h3>
        <p className="muted">This local version calculates progress from your current balance.</p>
        <div className="goal-form"><input type="number" min="0" value={goal} onChange={e => setGoal(e.target.value)} /><span>{currency}</span></div>
        <div className="large-progress"><i style={{ width: `${percent}%` }} /></div>
      </section>
    </div>
  )
}

function SettingsPage({ displayName, setDisplayName, currency, setCurrency, theme, setTheme, exportCSV, clearAllData, resetApp }: { displayName: string; setDisplayName: (v: string) => void; currency: string; setCurrency: (v: string) => void; theme: string; setTheme: (v: string) => void; exportCSV: () => void; clearAllData: () => void; resetApp: () => void }) {
  return (
    <div className="content">
      <section className="page-actions"><div><h2>Settings</h2><p>Customize your local SpendWise experience.</p></div></section>
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
          <p className="muted">Everything in this version is stored only in this browser using localStorage.</p>
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
