import React, { useState, useEffect } from 'react';
import {
  getKPIDashboard,
  calculateAllKPIs,
  KPIWithValue
} from '../services/analyticsService';

const KPIsDashboardPage: React.FC = () => {
  const [kpis, setKpis] = useState<KPIWithValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadKPIs();
  }, []);

  const loadKPIs = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current month dates
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const startDate = startOfMonth.toISOString().split('T')[0];
      const endDate = endOfMonth.toISOString().split('T')[0];

      const data = await getKPIDashboard(startDate, endDate);
      setKpis(data || []);
    } catch (err: any) {
      console.error('Error loading KPIs:', err);
      setError(err.response?.data?.error || 'Failed to load KPIs');
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateAll = async () => {
    try {
      setCalculating(true);
      setError(null);
      setSuccessMessage(null);

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const startDate = startOfMonth.toISOString().split('T')[0];
      const endDate = endOfMonth.toISOString().split('T')[0];

      await calculateAllKPIs(startDate, endDate);
      setSuccessMessage('All KPIs calculated successfully');
      await loadKPIs();
    } catch (err: any) {
      console.error('Error calculating KPIs:', err);
      setError(err.response?.data?.error || 'Failed to calculate KPIs');
    } finally {
      setCalculating(false);
    }
  };

  const formatValue = (kpi: KPIWithValue) => {
    if (kpi.current_value === undefined) return '—';

    switch (kpi.unit) {
      case 'currency':
        return new Intl.NumberFormat('sv-SE', {
          style: 'currency',
          currency: 'SEK',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(kpi.current_value);
      case 'percentage':
        return `${kpi.current_value.toFixed(1)}%`;
      case 'ratio':
        return kpi.current_value.toFixed(2);
      default:
        return kpi.current_value.toFixed(1);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'on_target':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'off_target':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return (
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'down':
        return (
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
          </svg>
        );
      default:
        return (
          <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
          </svg>
        );
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      financial: 'Financial',
      operational: 'Operational',
      customer: 'Customer',
      growth: 'Growth'
    };
    return labels[category] || category;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">KPI Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">
            Track and monitor key performance indicators
          </p>
        </div>
        <button
          onClick={handleCalculateAll}
          disabled={calculating}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {calculating ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Calculating...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Calculate All KPIs
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          {successMessage}
        </div>
      )}

      {/* KPIs by Category */}
      {['financial', 'operational', 'customer', 'growth'].map((category) => {
        const categoryKPIs = kpis.filter((k) => k.category === category);
        if (categoryKPIs.length === 0) return null;

        return (
          <div key={category} className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                {getCategoryLabel(category)} KPIs
              </h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryKPIs.map((kpi) => (
                  <div
                    key={kpi.id}
                    className={`p-4 rounded-lg border-2 ${getStatusColor(kpi.status)}`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="font-medium text-sm">{kpi.name}</h3>
                        {kpi.description && (
                          <p className="text-xs text-gray-600 mt-1">{kpi.description}</p>
                        )}
                      </div>
                      <div>{getTrendIcon(kpi.trend)}</div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-gray-600">Current Value</p>
                        <p className="text-2xl font-bold">{formatValue(kpi)}</p>
                      </div>
                      {kpi.target_value !== null && kpi.target_value !== undefined && (
                        <div>
                          <p className="text-xs text-gray-600">Target</p>
                          <p className="text-sm font-medium">
                            {kpi.unit === 'currency'
                              ? new Intl.NumberFormat('sv-SE', {
                                  style: 'currency',
                                  currency: 'SEK'
                                }).format(kpi.target_value)
                              : kpi.unit === 'percentage'
                              ? `${kpi.target_value.toFixed(1)}%`
                              : kpi.target_value}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {kpis.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No KPI data available</h3>
          <p className="mt-1 text-sm text-gray-500">
            Click "Calculate All KPIs" to generate KPI values for this period
          </p>
        </div>
      )}
    </div>
  );
};

export default KPIsDashboardPage;
