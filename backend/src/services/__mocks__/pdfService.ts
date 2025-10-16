export const generateInvoicePDF = jest.fn().mockResolvedValue({ 
  buffer: Buffer.from(''), 
  fileName: 'test.pdf'
});
export const generateInvoicePDFFromInvoiceId = jest.fn().mockResolvedValue({ 
  buffer: Buffer.from(''), 
  fileName: 'test.pdf'
});
