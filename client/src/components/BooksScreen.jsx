import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch } from '../utils/api.js'
import { ORANGE } from './books/shared'
import DashboardTab from './books/DashboardTab'
import BillingQueue from './books/BillingQueue'
import InvoicesTab from './books/InvoicesTab'
import ServicesTab from './books/ServicesTab'
import ReportsTab from './books/ReportsTab'
import ExpensesTab from './books/ExpensesTab'
import DepositsTab from './books/DepositsTab'
import BonusCalculator from './books/BonusCalculator'

// ── Main BooksScreen ──────────────────────────────────────────────────────────

export default function BooksScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('dashboard')
  const [invoices, setInvoices] = useState([])
  const [services, setServices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [deposits, setDeposits] = useState([])
  const [jobs, setJobs] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoicesError, setInvoicesError] = useState(null)
  const [servicesLoading, setServicesLoading] = useState(true)

  const loadInvoices = useCallback(() => {
    setInvoicesLoading(true)
    setInvoicesError(null)
    apiFetch(`${API_BASE}/api/books/invoices`)
      .then(r => r.json())
      .then(data => { setInvoices(Array.isArray(data) ? data : []); setInvoicesLoading(false) })
      .catch(err => { setInvoicesError(err.message); setInvoicesLoading(false) })
  }, [])

  const loadServices = useCallback(() => {
    setServicesLoading(true)
    apiFetch(`${API_BASE}/api/books/services`)
      .then(r => r.json())
      .then(data => { setServices(Array.isArray(data) ? data : []); setServicesLoading(false) })
      .catch(() => setServicesLoading(false))
  }, [])

  const loadExpenses = useCallback(() => {
    apiFetch(`${API_BASE}/api/books/expenses`)
      .then(r => r.json())
      .then(data => setExpenses(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const loadDeposits = useCallback(() => {
    apiFetch(`${API_BASE}/api/books/deposits`)
      .then(r => r.json())
      .then(data => setDeposits(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const loadJobs = useCallback(() => {
    apiFetch(`${API_BASE}/api/jobs`)
      .then(r => r.json())
      .then(data => {
        const all = Array.isArray(data) ? data : []
        // Only include completed jobs for billing queue
        setJobs(all.filter(j => j.status === 'complete'))
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { loadServices() }, [loadServices])
  useEffect(() => { loadExpenses() }, [loadExpenses])
  useEffect(() => { loadDeposits() }, [loadDeposits])
  useEffect(() => { loadJobs() }, [loadJobs])

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'queue',     label: 'Billing Queue' },
    { id: 'invoices',  label: 'Invoices' },
    { id: 'expenses',  label: 'Expenses' },
    { id: 'deposits',  label: 'Deposits' },
    { id: 'reports',   label: 'Reports' },
    { id: 'bonuses',   label: 'Bonuses' },
    { id: 'services',  label: 'Services' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Books</h1>
            <p className="text-sm text-gray-500 mt-0.5">Invoicing, expenses & financial reporting for Absolute ADAS</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 mb-6 border-b overflow-x-auto" style={{ borderColor: '#ebebeb' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-sm px-4 py-2.5 font-medium transition-colors whitespace-nowrap flex-shrink-0"
              style={{
                color: tab === t.id ? ORANGE : '#666',
                borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
                marginBottom: '-1px',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'dashboard' && (
          <DashboardTab
            invoices={invoices}
            expenses={expenses}
            onNewInvoice={() => setTab('invoices')}
          />
        )}

        {tab === 'queue' && (
          <BillingQueue
            invoices={invoices}
            jobs={jobs}
            onRefresh={() => { loadInvoices(); loadJobs() }}
            onEditInvoice={(inv) => { setTab('invoices') }}
          />
        )}

        {tab === 'invoices' && (
          <InvoicesTab
            invoices={invoices}
            services={services}
            loading={invoicesLoading}
            onRefresh={() => { loadInvoices(); loadServices() }}
          />
        )}

        {tab === 'expenses' && (
          <ExpensesTab expenses={expenses} onRefresh={loadExpenses} />
        )}

        {tab === 'deposits' && (
          <DepositsTab deposits={deposits} invoices={invoices} onRefresh={loadDeposits} />
        )}

        {tab === 'reports' && <ReportsTab />}

        {tab === 'bonuses' && (
          <BonusCalculator user={user} isAdmin={user?.role !== 'technician'} />
        )}

        {tab === 'services' && (
          servicesLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading services…</div>
          ) : (
            <ServicesTab services={services} onRefresh={loadServices} />
          )
        )}

        {invoicesError && tab !== 'invoices' && (
          <div className="mt-4 text-sm text-red-500 text-center">{invoicesError}</div>
        )}
      </div>
    </div>
  )
}
