import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useVATReport,
  useUpdateVATReport,
  useSubmitVATReport,
  useVATSubmissions,
  useExportVATReport,
} from '../../hooks/useVAT';
import { VATReportStatus } from '../../services/vatService';

export default function VATReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companyId = localStorage.getItem('currentCompanyId') || '';
  const [notes, setNotes] = useState('');
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [orgNumber, setOrgNumber] = useState('');

  const { data: report, isLoading, error } = useVATReport(id!, companyId);
  const { data: submissions } = useVATSubmissions(id!);
  const updateReport = useUpdateVATReport();
  const submitReport = useSubmitVATReport();
  const exportReport = useExportVATReport();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('sv-SE');
  };

  const handleApprove = async () => {
    if (!confirm('Är du säker på att du vill godkänna denna momsrapport?'))
      return;

    try {
      await updateReport.mutateAsync({
        id: id!,
        companyId,
        data: { status: VATReportStatus.APPROVED, notes },
      });
      alert('Momsrapporten har godkänts');
    } catch (error) {
      alert('Kunde inte godkänna momsrapporten');
    }
  };

  const handleSubmit = async () => {
    if (!orgNumber) {
      alert('Vänligen ange organisationsnummer');
      return;
    }

    try {
      await submitReport.mutateAsync({
        id: id!,
        data: { company_id: companyId, organization_number: orgNumber },
      });
      setShowSubmitDialog(false);
      alert('Momsrapporten har skickats till Skatteverket');
    } catch (error: any) {
      alert(error.message || 'Kunde inte skicka momsrapporten');
    }
  };

  const handleExport = async (format: 'json' | 'xml') => {
    try {
      await exportReport.mutateAsync({ id: id!, companyId, format });
    } catch (error) {
      alert('Kunde inte exportera momsrapporten');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Laddar momsrapport...</div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">
          Ett fel uppstod vid laddning av momsrapporten
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link
            to="/vat/reports"
            className="text-blue-600 hover:text-blue-800 mb-2 inline-block"
          >
            ← Tillbaka till momsrapporter
          </Link>
          <h1 className="text-3xl font-bold">
            Momsrapport {report.report_number}
          </h1>
          <p className="text-gray-600">
            Period: {formatDate(report.period_start)} -{' '}
            {formatDate(report.period_end)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('json')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Exportera JSON
          </button>
          <button
            onClick={() => handleExport('xml')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Exportera XML
          </button>
        </div>
      </div>

      {/* Status and Actions */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-semibold mb-2">Status</h2>
            <span
              className={`px-3 py-1 text-sm font-semibold rounded-full ${
                report.status === 'draft'
                  ? 'bg-gray-100 text-gray-800'
                  : report.status === 'approved'
                  ? 'bg-green-100 text-green-800'
                  : report.status === 'submitted'
                  ? 'bg-blue-100 text-blue-800'
                  : report.status === 'rejected'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {report.status === 'draft'
                ? 'Utkast'
                : report.status === 'approved'
                ? 'Godkänd'
                : report.status === 'submitted'
                ? 'Inskickad'
                : report.status === 'rejected'
                ? 'Avvisad'
                : 'Arkiverad'}
            </span>
          </div>
          <div className="flex gap-2">
            {report.status === 'draft' && (
              <button
                onClick={handleApprove}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                disabled={updateReport.isPending}
              >
                Godkänn rapport
              </button>
            )}
            {report.status === 'approved' && (
              <button
                onClick={() => setShowSubmitDialog(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Skicka till Skatteverket
              </button>
            )}
          </div>
        </div>
      </div>

      {/* VAT Summary */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Momssammanställning</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="border rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Utgående moms 25%</div>
            <div className="text-xl font-bold">
              {formatCurrency(report.outgoing_vat_25)}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Utgående moms 12%</div>
            <div className="text-xl font-bold">
              {formatCurrency(report.outgoing_vat_12)}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Utgående moms 6%</div>
            <div className="text-xl font-bold">
              {formatCurrency(report.outgoing_vat_6)}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Momsfri försäljning</div>
            <div className="text-xl font-bold">
              {formatCurrency(report.outgoing_vat_0)}
            </div>
          </div>
          <div className="border rounded-lg p-4 bg-blue-50">
            <div className="text-sm text-gray-600 mb-1">Total utgående moms</div>
            <div className="text-xl font-bold text-blue-900">
              {formatCurrency(report.total_outgoing_vat)}
            </div>
          </div>
          <div className="border rounded-lg p-4 bg-green-50">
            <div className="text-sm text-gray-600 mb-1">Ingående moms</div>
            <div className="text-xl font-bold text-green-900">
              {formatCurrency(report.incoming_vat)}
            </div>
          </div>
        </div>
        <div className="mt-6 border-t pt-4">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold">Netto att betala:</span>
            <span
              className={`text-2xl font-bold ${
                report.net_vat_amount >= 0 ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {formatCurrency(report.net_vat_amount)}
            </span>
          </div>
          {report.net_vat_amount < 0 && (
            <p className="text-sm text-gray-600 mt-2">
              Negativt belopp innebär att du får tillbaka pengar från
              Skatteverket.
            </p>
          )}
        </div>
      </div>

      {/* Transaction Details */}
      {report.lines && report.lines.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Transaktionsdetaljer</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                    Datum
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                    Typ
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                    Nummer
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Basbelopp
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Momssats
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Moms
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                    Typ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {report.lines.map((line: any) => (
                  <tr key={line.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm">
                      {formatDate(line.transaction_date)}
                    </td>
                    <td className="px-4 py-2 text-sm capitalize">
                      {line.transaction_type === 'invoice'
                        ? 'Faktura'
                        : line.transaction_type === 'receipt'
                        ? 'Kvitto'
                        : 'Journal'}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {line.transaction_number || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-right">
                      {formatCurrency(line.base_amount)}
                    </td>
                    <td className="px-4 py-2 text-sm text-right">
                      {line.vat_rate ? `${line.vat_rate}%` : '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-right font-medium">
                      {formatCurrency(line.vat_amount)}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {line.vat_type === 'outgoing' ? 'Utgående' : 'Ingående'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Submissions History */}
      {submissions && submissions.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Inskickningshistorik</h2>
          <div className="space-y-4">
            {submissions.map((submission: any) => (
              <div key={submission.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        submission.status === 'accepted'
                          ? 'bg-green-100 text-green-800'
                          : submission.status === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : submission.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {submission.status === 'accepted'
                        ? 'Godkänd'
                        : submission.status === 'rejected'
                        ? 'Avvisad'
                        : submission.status === 'pending'
                        ? 'Väntar'
                        : submission.status}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">
                    {formatDate(submission.submission_date)}
                  </span>
                </div>
                {submission.api_response_message && (
                  <p className="text-sm text-gray-600 mt-2">
                    {submission.api_response_message}
                  </p>
                )}
                {submission.api_request_id && (
                  <p className="text-xs text-gray-500 mt-1">
                    ID: {submission.api_request_id}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Anteckningar</h2>
        <textarea
          value={notes || report.notes || ''}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          rows={4}
          placeholder="Lägg till anteckningar..."
          disabled={report.status !== 'draft'}
        />
        {report.status === 'draft' && (
          <button
            onClick={() =>
              updateReport.mutate({
                id: id!,
                companyId,
                data: { notes },
              })
            }
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            disabled={updateReport.isPending}
          >
            Spara anteckningar
          </button>
        )}
      </div>

      {/* Submit Dialog */}
      {showSubmitDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">
              Skicka till Skatteverket
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Ange ditt organisationsnummer för att skicka rapporten till
              Skatteverket.
            </p>
            <input
              type="text"
              value={orgNumber}
              onChange={(e) => setOrgNumber(e.target.value)}
              placeholder="XXXXXX-XXXX"
              className="w-full px-3 py-2 border rounded-lg mb-4"
            />
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
              <p className="text-xs text-yellow-800">
                OBS: Skatteverket integration kräver särskild API-åtkomst.
                Kontakta Skatteverket för att få API-autentisering.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Avbryt
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={submitReport.isPending}
              >
                Skicka
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
