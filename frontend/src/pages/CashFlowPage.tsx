import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCashFlowSummary,
  calculateAvailableFunds,
  createSalaryWithdrawal,
  getBankTransactions,
  getPlannedExpenses
} from '../services/bankService';
import { CashFlowSummary, AvailableFundsCalculation, BankTransaction, PlannedExpense } from '../types/bank.types';

const CashFlowPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  const [calculation, setCalculation] = useState<AvailableFundsCalculation | null>(null);
  const [salaryAmount, setSalaryAmount] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<BankTransaction[]>([]);
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpense[]>([]);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalNotes, setWithdrawalNotes] = useState('');

  const companyId = localStorage.getItem('selectedCompanyId') || '';

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (summary) {
      recalculateAvailable();
    }
  }, [salaryAmount]);

  const loadData = async () => {
    try {
      setLoading(true);

      const [summaryData, transactionsData, expensesData] = await Promise.all([
        getCashFlowSummary(companyId),
        getBankTransactions(companyId, { limit: 10 }),
        getPlannedExpenses(companyId, 'pending')
      ]);

      setSummary(summaryData);
      setRecentTransactions(transactionsData.transactions);
      setPlannedExpenses(expensesData);

      // Initial calculation
      const calc = await calculateAvailableFunds(companyId, 0);
      setCalculation(calc);
    } catch (error) {
      console.error('Failed to load cash flow data:', error);
    } finally {
      setLoading(false);
    }
  };

  const recalculateAvailable = async () => {
    if (!companyId) return;

    try {
      const calc = await calculateAvailableFunds(companyId, salaryAmount);
      setCalculation(calc);
    } catch (error) {
      console.error('Failed to calculate available funds:', error);
    }
  };

  const handleRequestSalary = async () => {
    if (!salaryAmount || salaryAmount <= 0) {
      alert('Ange ett giltigt belopp');
      return;
    }

    if (calculation && !calculation.can_afford) {
      if (!confirm('Det finns inte tillräckligt med medel. Vill du fortsätta ändå?')) {
        return;
      }
    }

    try {
      await createSalaryWithdrawal(companyId, {
        requested_amount: salaryAmount,
        requested_date: new Date().toISOString().split('T')[0],
        notes: withdrawalNotes
      });

      alert('Löneanspråk skapat!');
      setSalaryAmount(0);
      setWithdrawalNotes('');
      setShowWithdrawalModal(false);
      loadData();
    } catch (error) {
      console.error('Failed to create salary withdrawal:', error);
      alert('Kunde inte skapa löneanspråk');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('sv-SE');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Laddar kassaflöde...</div>
      </div>
    );
  }

  if (!summary || !calculation) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-red-600">Kunde inte ladda kassaflödesdata</div>
      </div>
    );
  }

  const maxSalary = Math.floor(calculation.available_amount);
  const salaryPercentage = maxSalary > 0 ? (salaryAmount / maxSalary) * 100 : 0;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Kassaflödesöversikt</h1>
        <p className="text-gray-600">Se ditt aktuella kassaflöde och planera uttag</p>
      </div>

      {/* Warnings */}
      {summary.warnings.length > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Varningar</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <ul className="list-disc list-inside space-y-1">
                  {summary.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Aktuellt Saldo</h3>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(summary.current_balance)}</p>
          <p className="text-xs text-gray-500 mt-2">Från banktransaktioner</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Beräknat Saldo</h3>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(summary.projected_balance)}</p>
          <p className="text-xs text-gray-500 mt-2">Efter planerade in/utbetalningar</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Tillgängligt för Uttag</h3>
          <p className="text-3xl font-bold text-green-600">{formatCurrency(summary.available_for_withdrawal)}</p>
          <p className="text-xs text-gray-500 mt-2">Efter säkerhetsmarginal</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Säkerhetsmarginal</h3>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(summary.safety_margin)}</p>
          <p className="text-xs text-gray-500 mt-2">Buffert för oväntade utgifter</p>
        </div>
      </div>

      {/* Salary Withdrawal Slider */}
      <div className="bg-white rounded-lg shadow p-8 mb-8">
        <h2 className="text-2xl font-bold mb-6">Beräkna Löneutag</h2>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">Önskat belopp</label>
            <span className="text-2xl font-bold text-blue-600">{formatCurrency(salaryAmount)}</span>
          </div>

          <input
            type="range"
            min="0"
            max={maxSalary}
            step="1000"
            value={salaryAmount}
            onChange={(e) => setSalaryAmount(Number(e.target.value))}
            className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${salaryPercentage}%, #e5e7eb ${salaryPercentage}%, #e5e7eb 100%)`
            }}
          />

          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0 kr</span>
            <span>{formatCurrency(maxSalary)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600">Aktuellt saldo</p>
            <p className="text-lg font-semibold">{formatCurrency(calculation.breakdown.current_balance)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600">Kommande inkomster</p>
            <p className="text-lg font-semibold text-green-600">+{formatCurrency(calculation.breakdown.upcoming_income)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600">Planerade utgifter</p>
            <p className="text-lg font-semibold text-red-600">-{formatCurrency(calculation.breakdown.upcoming_expenses)}</p>
          </div>
        </div>

        {calculation.warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <ul className="text-sm text-yellow-800 space-y-1">
              {calculation.warnings.map((warning, index) => (
                <li key={index}>⚠️ {warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-800">Kvar efter uttag:</span>
            <span className="text-xl font-bold text-blue-900">
              {formatCurrency(calculation.remaining_after_withdrawal)}
            </span>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setShowWithdrawalModal(true)}
            disabled={salaryAmount <= 0}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold ${
              salaryAmount > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Begär Löneutbetalning
          </button>
          <button
            onClick={() => setSalaryAmount(0)}
            className="px-6 py-3 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50"
          >
            Återställ
          </button>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Hantera Kassaflöde</h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate('/transactions')}
              className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
            >
              📊 Se alla transaktioner
            </button>
            <button
              onClick={() => navigate('/transactions/upload')}
              className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
            >
              📤 Ladda upp transaktionsfil
            </button>
            <button
              onClick={() => navigate('/planned-expenses')}
              className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
            >
              📅 Planerade utgifter ({plannedExpenses.length})
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Utbetalningar</h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate('/salary-withdrawals')}
              className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
            >
              💰 Mina löneanspråk
            </button>
            <button
              onClick={() => navigate('/expense-reimbursements')}
              className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
            >
              🧾 Utläggsanspråk
            </button>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h3 className="text-lg font-semibold mb-4">Senaste Transaktioner</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Belopp</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{formatDate(transaction.transaction_date)}</td>
                  <td className="px-4 py-3 text-sm">{transaction.description}</td>
                  <td className={`px-4 py-3 text-sm text-right font-semibold ${
                    transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(transaction.amount)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs ${
                      transaction.status === 'matched' ? 'bg-green-100 text-green-800' :
                      transaction.status === 'duplicate' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {transaction.status === 'matched' ? 'Matchad' :
                       transaction.status === 'duplicate' ? 'Duplikat' :
                       transaction.status === 'ignored' ? 'Ignorerad' : 'Omatchad'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Withdrawal Modal */}
      {showWithdrawalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">Bekräfta Löneutbetalning</h2>
            <p className="mb-4">
              Du begär ett löneutag på <strong>{formatCurrency(salaryAmount)}</strong>.
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Meddelande (valfritt)
              </label>
              <textarea
                value={withdrawalNotes}
                onChange={(e) => setWithdrawalNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Lägg till en kommentar..."
              />
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleRequestSalary}
                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
              >
                Bekräfta
              </button>
              <button
                onClick={() => setShowWithdrawalModal(false)}
                className="flex-1 border border-gray-300 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50"
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashFlowPage;
