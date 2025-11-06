import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import CompanySwitcher from './components/CompanySwitcher'
import CustomerListPage from './pages/customers/CustomerListPage'
import CustomerFormPage from './pages/customers/CustomerFormPage'
import CustomerDetailPage from './pages/customers/CustomerDetailPage'
// FAS 4.1: Multi-Company Management Pages
import CompanyGroupsPage from './pages/CompanyGroupsPage'
import CrossCompanyTransactionsPage from './pages/CrossCompanyTransactionsPage'
import ConsolidatedReportsPage from './pages/ConsolidatedReportsPage'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {/* Navigation Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-8">
                <Link to="/" className="text-xl font-bold text-gray-900">
                  Redovisningssystem
                </Link>
                <nav className="hidden md:flex gap-6">
                  <Link to="/customers" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                    Customers
                  </Link>
                  <Link to="/company-groups" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                    Company Groups
                  </Link>
                  <Link to="/cross-company-transactions" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                    Transactions
                  </Link>
                  <Link to="/consolidated-reports" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                    Reports
                  </Link>
                </nav>
              </div>
              <div className="flex items-center gap-4">
                <CompanySwitcher />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main>
          <Routes>
            <Route path="/" element={
              <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
                <div className="text-center">
                  <h1 className="text-4xl font-bold text-gray-900 mb-4">
                    Redovisningssystem
                  </h1>
                  <p className="text-gray-600 mb-8">
                    AI-drivet redovisningssystem - FAS 4.1 Multi-Company Management
                  </p>
                  <div className="flex gap-4 justify-center">
                    <Link to="/company-groups" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Company Groups
                    </Link>
                    <Link to="/cross-company-transactions" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      Transactions
                    </Link>
                    <Link to="/consolidated-reports" className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                      Reports
                    </Link>
                  </div>
                </div>
              </div>
            } />

            {/* Customer routes */}
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />

            {/* FAS 4.1: Multi-Company Management routes */}
            <Route path="/company-groups" element={<CompanyGroupsPage />} />
            <Route path="/cross-company-transactions" element={<CrossCompanyTransactionsPage />} />
            <Route path="/consolidated-reports" element={<ConsolidatedReportsPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
