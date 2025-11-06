import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useGenerateVATReport, useVATSummary } from '../../hooks/useVAT';

export default function VATReportGeneratePage() {
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [previewEnabled, setPreviewEnabled] = useState(false);

  const generateReport = useGenerateVATReport();
  const { data: summary, isLoading: summaryLoading } = useVATSummary(
    companyId,
    periodStart,
    periodEnd,
    previewEnabled
  );

  // Initialize with current month
  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11

    // Start of current month
    const start = new Date(year, month, 1);
    // End of current month
    const end = new Date(year, month + 1, 0);

    setPeriodStart(start.toISOString().split('T')[0]);
    setPeriodEnd(end.toISOString().split('T')[0]);
  }, []);

  const handlePreview = () => {
    if (!periodStart || !periodEnd) {
      alert('Vänligen välj en period');
      return;
    }
    setPreviewEnabled(true);
  };

  const handleGenerate = async () => {
    if (!periodStart || !periodEnd) {
      alert('Vänligen välj en period');
      return;
    }

    if (
      !confirm(
        'Är du säker på att du vill skapa en momsrapport för denna period?'
      )
    ) {
      return;
    }

    try {
      const report = await generateReport.mutateAsync({
        company_id: companyId,
        period_start: periodStart,
        period_end: periodEnd,
      });
      alert('Momsrapport har skapats');
      navigate(`/vat/reports/${report.id}`);
    } catch (error: any) {
      alert(error.message || 'Kunde inte skapa momsrapport');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
    }).format(amount);
  };

  const setQuickPeriod = (type: 'current' | 'last' | 'quarter') => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    let start: Date, end: Date;

    switch (type) {
      case 'current':
        // Current month
        start = new Date(year, month, 1);
        end = new Date(year, month + 1, 0);
        break;
      case 'last':
        // Last month
        start = new Date(year, month - 1, 1);
        end = new Date(year, month, 0);
        break;
      case 'quarter':
        // Current quarter
        const quarterMonth = Math.floor(month / 3) * 3;
        start = new Date(year, quarterMonth, 1);
        end = new Date(year, quarterMonth + 3, 0);
        break;
    }

    setPeriodStart(start.toISOString().split('T')[0]);
    setPeriodEnd(end.toISOString().split('T')[0]);
    setPreviewEnabled(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          to="/vat/reports"
          className="text-blue-600 hover:text-blue-800 mb-2 inline-block"
        >
          ← Tillbaka till momsrapporter
        </Link>
        <h1 className="text-3xl font-bold">Skapa ny momsrapport</h1>
        <p className="text-gray-600 mt-2">
          Välj period för att generera en momsrapport baserat på dina fakturor
          och kvitton.
        </p>
      </div>

      {/* Period Selection */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Välj period</h2>

        {/* Quick period buttons */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setQuickPeriod('last')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Föregående månad
          </button>
          <button
            onClick={() => setQuickPeriod('current')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Innevarande månad
          </button>
          <button
            onClick={() => setQuickPeriod('quarter')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Innevarande kvartal
          </button>
        </div>

        {/* Custom period */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Startdatum
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => {
                setPeriodStart(e.target.value);
                setPreviewEnabled(false);
              }}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Slutdatum
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => {
                setPeriodEnd(e.target.value);
                setPreviewEnabled(false);
              }}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>

        <button
          onClick={handlePreview}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          disabled={!periodStart || !periodEnd}
        >
          Förhandsgranska
        </button>
      </div>

      {/* Preview Summary */}
      {previewEnabled && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            Förhandsgranskning av momsberäkning
          </h2>

          {summaryLoading ? (
            <div className="text-center py-8 text-gray-500">
              Beräknar moms...
            </div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Utgående moms 25%
                  </div>
                  <div className="text-xl font-bold">
                    {formatCurrency(summary.outgoing_vat_25)}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Utgående moms 12%
                  </div>
                  <div className="text-xl font-bold">
                    {formatCurrency(summary.outgoing_vat_12)}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Utgående moms 6%
                  </div>
                  <div className="text-xl font-bold">
                    {formatCurrency(summary.outgoing_vat_6)}
                  </div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Momsfri försäljning
                  </div>
                  <div className="text-xl font-bold">
                    {formatCurrency(summary.outgoing_vat_0)}
                  </div>
                </div>
                <div className="border rounded-lg p-4 bg-blue-50">
                  <div className="text-sm text-gray-600 mb-1">
                    Total utgående moms
                  </div>
                  <div className="text-xl font-bold text-blue-900">
                    {formatCurrency(summary.total_outgoing_vat)}
                  </div>
                </div>
                <div className="border rounded-lg p-4 bg-green-50">
                  <div className="text-sm text-gray-600 mb-1">
                    Ingående moms
                  </div>
                  <div className="text-xl font-bold text-green-900">
                    {formatCurrency(summary.incoming_vat)}
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">
                    Netto att betala:
                  </span>
                  <span
                    className={`text-2xl font-bold ${
                      summary.net_vat_amount >= 0
                        ? 'text-red-600'
                        : 'text-green-600'
                    }`}
                  >
                    {formatCurrency(summary.net_vat_amount)}
                  </span>
                </div>
                {summary.net_vat_amount < 0 && (
                  <p className="text-sm text-gray-600 mt-2">
                    Negativt belopp innebär att du får tillbaka pengar från
                    Skatteverket.
                  </p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Antal transaktioner:</strong>{' '}
                  {summary.transaction_count}
                </p>
              </div>

              <button
                onClick={handleGenerate}
                className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
                disabled={generateReport.isPending}
              >
                {generateReport.isPending
                  ? 'Skapar rapport...'
                  : 'Skapa momsrapport'}
              </button>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              Inga transaktioner hittades för denna period.
            </div>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-900 mb-2">Information</h3>
        <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
          <li>
            Rapporten baseras på fakturor och kvitton i det valda
            datumintervallet
          </li>
          <li>
            Endast godkända och betalda fakturor samt bokförda kvitton inkluderas
          </li>
          <li>
            Du kan förhandsgranska beräkningen innan du skapar rapporten
          </li>
          <li>
            Efter att rapporten skapats kan du granska den, godkänna och skicka
            till Skatteverket
          </li>
        </ul>
      </div>
    </div>
  );
}
