import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useVATReports, useDeleteVATReport } from '../../hooks/useVAT';
import { VATReportStatus } from '../../services/vatService';

export default function VATReportListPage() {
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [statusFilter, setStatusFilter] = useState<VATReportStatus | ''>('');

  const { data, isLoading, error } = useVATReports(companyId, {
    status: statusFilter || undefined,
  });
  const deleteReport = useDeleteVATReport();

  const handleDelete = async (id: string) => {
    if (confirm('Är du säker på att du vill ta bort denna momsrapport?')) {
      try {
        await deleteReport.mutateAsync({ id, companyId });
        alert('Momsrapporten har tagits bort');
      } catch (error) {
        alert('Kunde inte ta bort momsrapporten');
      }
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('sv-SE');
  };

  const getStatusBadge = (status: VATReportStatus) => {
    const styles: Record<VATReportStatus, string> = {
      draft: 'bg-gray-100 text-gray-800',
      approved: 'bg-green-100 text-green-800',
      submitted: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      archived: 'bg-gray-100 text-gray-600',
    };

    const labels: Record<VATReportStatus, string> = {
      draft: 'Utkast',
      approved: 'Godkänd',
      submitted: 'Inskickad',
      rejected: 'Avvisad',
      archived: 'Arkiverad',
    };

    return (
      <span
        className={`px-2 py-1 text-xs font-semibold rounded-full ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Laddar momsrapporter...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">
          Ett fel uppstod vid laddning av momsrapporter
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Momsrapporter</h1>
        <Link
          to="/vat/reports/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Skapa ny rapport
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VATReportStatus | '')}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">Alla statusar</option>
          <option value="draft">Utkast</option>
          <option value="approved">Godkänd</option>
          <option value="submitted">Inskickad</option>
          <option value="rejected">Avvisad</option>
          <option value="archived">Arkiverad</option>
        </select>
      </div>

      {/* Reports List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {data && data.length > 0 ? (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Rapportnummer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Period
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Utgående moms
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Ingående moms
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Netto att betala
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Åtgärder
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((report: any) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      to={`/vat/reports/${report.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {report.report_number || report.id.substring(0, 8)}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(report.period_start)} - {formatDate(report.period_end)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                    {formatCurrency(report.total_outgoing_vat)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                    {formatCurrency(report.incoming_vat)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span
                      className={`font-bold ${
                        report.net_vat_amount >= 0
                          ? 'text-red-600'
                          : 'text-green-600'
                      }`}
                    >
                      {formatCurrency(report.net_vat_amount)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(report.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <Link
                      to={`/vat/reports/${report.id}`}
                      className="text-blue-600 hover:text-blue-800 mr-4"
                    >
                      Visa
                    </Link>
                    {report.status === 'draft' && (
                      <button
                        onClick={() => handleDelete(report.id)}
                        className="text-red-600 hover:text-red-800"
                        disabled={deleteReport.isPending}
                      >
                        Ta bort
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-12 text-center text-gray-500">
            <p className="text-lg mb-4">Inga momsrapporter hittades</p>
            <Link
              to="/vat/reports/new"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Skapa din första momsrapport
            </Link>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">
          Om momsrapporter
        </h3>
        <p className="text-sm text-blue-800">
          Momsrapporter genereras automatiskt baserat på dina fakturor och
          kvitton. Kontrollera rapporten noggrant innan du godkänner och skickar
          in den till Skatteverket.
        </p>
      </div>
    </div>
  );
}
