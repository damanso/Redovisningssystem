import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import CustomerListPage from './pages/customers/CustomerListPage'
import CustomerFormPage from './pages/customers/CustomerFormPage'
import CustomerDetailPage from './pages/customers/CustomerDetailPage'
import ProjectListPage from './pages/projects/ProjectListPage'
import ProjectFormPage from './pages/projects/ProjectFormPage'
import ProjectDetailPage from './pages/projects/ProjectDetailPage'

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

          {/* Project routes */}
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/new" element={<ProjectFormPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/edit" element={<ProjectFormPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
