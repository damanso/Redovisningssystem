import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getKPIDashboard,
  getQuickProjection,
  getBudgets,
  KPIWithValue
} from '../services/analyticsService';

const AnalyticsDashboard: React.FC = () => {
  const [kpis, setKpis] = useState<KPIWithValue[]>([]);
  const [cashFlowProjection, setCashFlowProjection] = useState<any>(null);
  const [budgetCount, setBudgetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current month dates
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const startDate = startOfMonth.toISOString().split('T')[0];
      const endDate = endOfMonth.toISOString().split('T')[0];

      // Load KPIs
      const kpiData = await getKPIDashboard(startDate, endDate);
      setKpis(kpiData || []);

      // Load cash flow projection
      const projection = await getQuickProjection(30);
      setCashFlowProjection(projection);

      // Load budgets count
      const budgets = await getBudgets();
      setBudgetCount(budgets?.length || 0);
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      setError(err.response?.data?.error || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const getKPIStatusColor = (status?: string) => {
    switch (status) {
      case 'on_target':
        return 'text-green-600 bg-green-50';
      case 'off_target':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return '↑';
      case 'down':
        return '↓';
      default:
        return '→';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Advanced Analytics</h1>
        <div className="text-sm text-gray-500">
          Dashboard Overview
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Cash Flow Card */}
        <Link to="/analytics/cash-flow" className="block">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-600">Cash Flow (30 days)</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {cashFlowProjection ? formatCurrency(cashFlowProjection.projected_balance) : '—'}
                </p>
                {cashFlowProjection && (
                  <p className="text-sm text-gray-500 mt-1">
                    Current: {formatCurrency(cashFlowProjection.current_balance)}
                  </p>
                )}
              </div>
              <div className="text-blue-600">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        {/* KPIs Card */}
        <Link to="/analytics/kpis" className="block">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-600">Active KPIs</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{kpis.length}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {kpis.filter(k => k.status === 'on_target').length} on target
                </p>
              </div>
              <div className="text-green-600">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        {/* Budgets Card */}
        <Link to="/analytics/budgets" className="block">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Budgets</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{budgetCount}</p>
                <p className="text-sm text-gray-500 mt-1">Budget tracking</p>
              </div>
              <div className="text-purple-600">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* KPIs Overview */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Key Performance Indicators</h2>
          <Link
            to="/analytics/kpis"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View All →
          </Link>
        </div>
        <div className="p-6">
          {kpis.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No KPIs available</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpis.slice(0, 6).map((kpi) => (
                <div
                  key={kpi.id}
                  className={`p-4 rounded-lg border ${getKPIStatusColor(kpi.status)}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{kpi.name}</p>
                      <p className="text-2xl font-bold mt-2">
                        {kpi.current_value !== undefined ? (
                          kpi.unit === 'currency' ? (
                            formatCurrency(kpi.current_value)
                          ) : kpi.unit === 'percentage' ? (
                            formatPercentage(kpi.current_value)
                          ) : (
                            kpi.current_value.toFixed(1)
                          )
                        ) : (
                          '—'
                        )}
                      </p>
                      {kpi.target_value && (
                        <p className="text-xs mt-1">
                          Target: {kpi.unit === 'currency'
                            ? formatCurrency(kpi.target_value)
                            : kpi.unit === 'percentage'
                            ? formatPercentage(kpi.target_value)
                            : kpi.target_value}
                        </p>
                      )}
                    </div>
                    <div className="text-2xl font-bold">
                      {getTrendIcon(kpi.trend)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cash Flow Projection */}
      {cashFlowProjection && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Cash Flow Projection (30 Days)</h2>
            <Link
              to="/analytics/cash-flow"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View Details →
            </Link>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-medium text-gray-600">Expected Inflows</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  {formatCurrency(cashFlowProjection.expected_inflows)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Expected Outflows</p>
                <p className="text-2xl font-bold text-red-600 mt-1">
                  {formatCurrency(cashFlowProjection.expected_outflows)}
                </p>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600">Projected Balance</span>
                <span className="text-xl font-bold text-gray-900">
                  {formatCurrency(cashFlowProjection.projected_balance)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            to="/analytics/budgets/new"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="font-medium text-gray-700">Create Budget</span>
          </Link>
          <Link
            to="/analytics/cash-flow/new"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="font-medium text-gray-700">New Forecast</span>
          </Link>
          <Link
            to="/analytics/kpis"
            className="flex items-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="font-medium text-gray-700">Calculate KPIs</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
