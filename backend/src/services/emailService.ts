import nodemailer from 'nodemailer';
import { generateInvoicePDF } from './pdfService.js';
import { getInvoiceById } from './invoiceService.js';
import { getCompanyById } from './companyService.js';
import { getCustomerById } from './customerService.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // Use TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Send invoice email with PDF attachment
 */
export const sendInvoiceEmail = async (
  invoiceId: string,
  companyId: string,
  recipientEmail: string,
  recipientName: string
): Promise<void> => {
  const invoice = await getInvoiceById(invoiceId, companyId);
  const company = await getCompanyById(companyId);
  const customer = await getCustomerById(invoice.customer_id, companyId);

  if (!company) {
    throw new Error('Company not found');
  }

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Prepare PDF data
  const pdfData = {
    invoice: {
      invoice_number: invoice.invoice_number,
      invoice_date: new Date(invoice.invoice_date).toISOString().split('T')[0],
      due_date: new Date(invoice.due_date).toISOString().split('T')[0],
      ocr_number: invoice.ocr_number || '',
      reference: invoice.reference,
      notes: invoice.notes
    },
    company: {
      name: company.name,
      org_number: company.org_number,
      address: company.address || '',
      postal_code: company.postal_code || '',
      city: company.city || '',
      phone: company.phone,
      email: company.email,
      website: company.website,
      vat_number: company.vat_number || '',
      bank_account: (company as any).bank_account || ''
    },
    customer: {
      name: customer.name,
      org_number: customer.org_number,
      address: customer.address_street,
      postal_code: customer.address_postal_code,
      city: customer.address_city
    },
    lines: (invoice.lines || []).map((line: any) => ({
      description: line.description,
      quantity: parseFloat(line.quantity),
      unit: line.unit,
      unit_price: parseFloat(line.unit_price),
      vat_rate: parseFloat(line.vat_rate),
      amount: parseFloat(line.amount)
    })),
    totals: {
      subtotal: Number(invoice.subtotal),
      vat_amount: Number(invoice.vat_amount),
      total_amount: Number(invoice.total_amount)
    }
  };

  // Generate PDF
  const { buffer } = await generateInvoicePDF(pdfData);

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@redovisning.se',
    to: recipientEmail,
    subject: `Faktura ${invoice.invoice_number} från ${company.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Faktura från ${company.name}</h2>
        <p>Hej ${recipientName},</p>
        <p>Bifogat finner du faktura ${invoice.invoice_number}.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
          <tr style="background: #f0f0f0;">
            <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Fakturanummer:</td>
            <td style="padding: 12px; border-bottom: 1px solid #ddd;">${invoice.invoice_number}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Fakturadatum:</td>
            <td style="padding: 12px; border-bottom: 1px solid #ddd;">${new Date(invoice.invoice_date).toLocaleDateString('sv-SE')}</td>
          </tr>
          <tr style="background: #f0f0f0;">
            <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold;">Förfallodatum:</td>
            <td style="padding: 12px; border-bottom: 1px solid #ddd;">${new Date(invoice.due_date).toLocaleDateString('sv-SE')}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold;">Att betala:</td>
            <td style="padding: 12px; font-size: 18px; font-weight: bold; color: #007bff;">
              ${invoice.total_amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
            </td>
          </tr>
        </table>

        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196f3;">
          <h3 style="margin-top: 0; color: #1976d2;">Betalningsinformation</h3>
          <p style="margin: 8px 0;"><strong>Bankgiro:</strong> ${(company as any).bank_account || 'Kontakta oss för betalningsuppgifter'}</p>
          <p style="margin: 8px 0;"><strong>OCR-nummer:</strong> ${invoice.ocr_number || 'Ej tillämpligt'}</p>
          <p style="margin: 8px 0;"><strong>Förfallodatum:</strong> ${new Date(invoice.due_date).toLocaleDateString('sv-SE')}</p>
        </div>

        ${invoice.notes ? `
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <h4 style="margin-top: 0; color: #856404;">Meddelande:</h4>
          <p style="margin: 0;">${invoice.notes}</p>
        </div>
        ` : ''}

        <p style="margin-top: 30px;">Vid frågor, kontakta oss på:</p>
        <p style="margin: 5px 0;">
          ${company.email ? `📧 ${company.email}` : ''}
          ${company.email && company.phone ? ' | ' : ''}
          ${company.phone ? `📞 ${company.phone}` : ''}
        </p>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

        <p style="color: #666; font-size: 12px; text-align: center;">
          Med vänliga hälsningar,<br>
          <strong>${company.name}</strong><br>
          ${company.org_number ? `Org.nr: ${company.org_number}` : ''}
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `faktura-${invoice.invoice_number}.pdf`,
        content: buffer,
        contentType: 'application/pdf'
      }
    ]
  };

  await transporter.sendMail(mailOptions);
};

/**
 * Send welcome email to new user
 */
export const sendWelcomeEmail = async (
  userEmail: string,
  userName: string
): Promise<void> => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@redovisning.se',
    to: userEmail,
    subject: 'Välkommen till Redovisningssystemet!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Välkommen ${userName}!</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px 20px;">
          <h2 style="color: #333; margin-top: 0;">Tack för att du registrerade dig</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #555;">
            Vi är glada att ha dig ombord! Nu kan du börja använda systemet för att hantera din redovisning på ett enkelt och effektivt sätt.
          </p>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #667eea; margin-top: 0;">Kom igång:</h3>
            <ul style="line-height: 1.8; color: #555;">
              <li>📊 Skapa ditt första företag</li>
              <li>👥 Lägg till kunder och leverantörer</li>
              <li>📄 Skapa och skicka fakturor</li>
              <li>🧾 Ladda upp kvitton för automatisk bearbetning</li>
              <li>📈 Följ din ekonomi i realtid</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/login"
               style="background: #667eea; color: white; padding: 14px 32px;
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: bold; font-size: 16px;">
              Logga in nu
            </a>
          </div>

          <p style="font-size: 14px; color: #777; margin-top: 30px;">
            Behöver du hjälp? Kontakta vår support på
            <a href="mailto:support@redovisning.se" style="color: #667eea;">support@redovisning.se</a>
          </p>
        </div>

        <div style="background: #333; color: #999; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px;">
          © ${new Date().getFullYear()} Redovisningssystemet. Alla rättigheter förbehållna.
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  userEmail: string,
  userName: string,
  resetToken: string
): Promise<void> => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@redovisning.se',
    to: userEmail,
    subject: 'Återställ ditt lösenord',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f44336; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🔒 Återställ ditt lösenord</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px 20px;">
          <p style="font-size: 16px; color: #333;">Hej ${userName},</p>
          <p style="font-size: 16px; line-height: 1.6; color: #555;">
            Vi har tagit emot en begäran om att återställa lösenordet för ditt konto.
            Om du inte har begärt detta, kan du ignorera detta e-postmeddelande.
          </p>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f44336;">
            <p style="margin: 0; color: #555;">
              <strong>Klicka på knappen nedan för att skapa ett nytt lösenord:</strong>
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}"
               style="background: #f44336; color: white; padding: 14px 32px;
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: bold; font-size: 16px;">
              Återställ lösenord
            </a>
          </div>

          <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #856404;">
              ⚠️ <strong>Viktigt:</strong> Länken är giltig i 1 timme.
            </p>
          </div>

          <p style="font-size: 13px; color: #999; margin-top: 20px;">
            Om knappen ovan inte fungerar, kopiera och klistra in följande länk i din webbläsare:
          </p>
          <p style="font-size: 12px; color: #667eea; word-break: break-all;">
            ${resetUrl}
          </p>
        </div>

        <div style="background: #333; color: #999; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px;">
          Om du inte begärde denna återställning, ignorera detta e-postmeddelande.<br>
          Ditt lösenord kommer inte att ändras.
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};

/**
 * Verify email configuration
 */
export const verifyEmailConfig = async (): Promise<boolean> => {
  try {
    await transporter.verify();
    return true;
  } catch (error) {
    console.error('Email configuration error:', error);
    return false;
  }
};
