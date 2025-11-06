import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import CustomerListPage from './pages/customers/CustomerListPage'
import CustomerFormPage from './pages/customers/CustomerFormPage'
import CustomerDetailPage from './pages/customers/CustomerDetailPage'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import BudgetsPage from './pages/BudgetsPage'
import KPIsDashboardPage from './pages/KPIsDashboardPage'
import CashFlowPage from './pages/CashFlowPage'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={
            <div className="flex items-center justify-center min-h-screen">
              <div className="text-center">
                <h1 className="text-4xl font-bold text-gray-900 mb-4">
                  Redovisningssystem
                </h1>
                <p className="text-gray-600">
                  AI-drivet redovisningssystem - Setup komplett
                </p>
              </div>
            </div>
          } />

          {/* Customer routes */}
          <Route path="/customers" element={<CustomerListPage />} />
          <Route path="/customers/new" element={<CustomerFormPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/customers/:id/edit" element={<CustomerFormPage />} />

          {/* Analytics routes */}
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/analytics/budgets" element={<BudgetsPage />} />
          <Route path="/analytics/kpis" element={<KPIsDashboardPage />} />
          <Route path="/analytics/cash-flow" element={<CashFlowPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
