import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getCashFlowForecasts,
  getQuickProjection,
  CashFlowForecast
} from '../services/analyticsService';

const CashFlowPage: React.FC = () => {
  const [forecasts, setForecasts] = useState<CashFlowForecast[]>([]);
  const [quickProjection, setQuickProjection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [forecastsData, projectionData] = await Promise.all([
        getCashFlowForecasts(),
        getQuickProjection(30)
      ]);

      setForecasts(forecastsData || []);
      setQuickProjection(projectionData);
    } catch (err: any) {
      console.error('Error loading cash flow data:', err);
      setError(err.response?.data?.error || 'Failed to load cash flow data');
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

  const getForecastTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      conservative: 'Conservative',
      realistic: 'Realistic',
      optimistic: 'Optimistic'
    };
    return labels[type] || type;
  };

  const getForecastTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'conservative':
        return 'bg-yellow-100 text-yellow-800';
      case 'realistic':
        return 'bg-blue-100 text-blue-800';
      case 'optimistic':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
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
          <h1 className="text-3xl font-bold text-gray-900">Cash Flow Forecasting</h1>
          <p className="mt-2 text-sm text-gray-600">
            Predict future cash positions and plan for cash flow needs
          </p>
        </div>
        <Link
          to="/analytics/cash-flow/new"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Forecast
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Quick Projection */}
      {quickProjection && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">30-Day Quick Projection</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <p className="text-sm font-medium text-gray-600">Current Balance</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(quickProjection.current_balance)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Expected Inflows</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  +{formatCurrency(quickProjection.expected_inflows)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Expected Outflows</p>
                <p className="text-2xl font-bold text-red-600 mt-1">
                  -{formatCurrency(quickProjection.expected_outflows)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Projected Balance</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">
                  {formatCurrency(quickProjection.projected_balance)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {quickProjection.projected_balance > quickProjection.current_balance
                    ? '↑ Improving'
                    : '↓ Declining'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Forecasts List */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Detailed Forecasts</h2>
        </div>
        {forecasts.length === 0 ? (
          <div className="text-center py-12">
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
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No forecasts</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a detailed cash flow forecast
            </p>
            <div className="mt-6">
              <Link
                to="/analytics/cash-flow/new"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Forecast
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Period
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Opening Balance
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {forecasts.map((forecast) => (
                  <tr key={forecast.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{forecast.name}</div>
                        {forecast.description && (
                          <div className="text-sm text-gray-500">{forecast.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getForecastTypeBadgeClass(
                          forecast.forecast_type
                        )}`}
                      >
                        {getForecastTypeLabel(forecast.forecast_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(forecast.start_date).toLocaleDateString('sv-SE')} -{' '}
                      {new Date(forecast.end_date).toLocaleDateString('sv-SE')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(forecast.opening_balance)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        to={`/analytics/cash-flow/${forecast.id}`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Feature Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-blue-900 mb-2">Cash Flow Forecasting Features</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-blue-800">
          <li>Automatic forecast generation based on historical data</li>
          <li>Multiple forecast scenarios (conservative, realistic, optimistic)</li>
          <li>Expected receivables and payables tracking</li>
          <li>Payment pattern analysis</li>
          <li>Cash flow visualization and projections</li>
        </ul>
      </div>
    </div>
  );
};

export default CashFlowPage;
