import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'sk-test-key'
});

export interface ReceiptOCRData {
  supplier_name?: string;
  receipt_date?: string;
  amount?: number;
  vat_amount?: number;
  total_amount?: number;
  category?: string;
  line_items?: Array<{
    description: string;
    amount: number;
  }>;
  confidence: number;
}

/**
 * Extract receipt data from image using Claude Vision API
 * @param filePathOrUrl - Local file path or URL to the receipt image
 * @returns Extracted receipt data with confidence score
 */
export const extractReceiptData = async (
  filePathOrUrl: string
): Promise<ReceiptOCRData> => {
  try {
    let base64Image: string;
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';

    // Check if it's a local file path or URL
    if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
      // TODO: Download from URL if needed
      throw new Error('URL-based OCR not implemented yet');
    } else {
      // Local file path
      const fullPath = filePathOrUrl.startsWith('/uploads/')
        ? path.join(process.cwd(), filePathOrUrl)
        : filePathOrUrl;

      // Read file
      const fileBuffer = await fs.readFile(fullPath);
      base64Image = fileBuffer.toString('base64');

      // Determine media type from file extension
      const ext = path.extname(fullPath).toLowerCase();
      if (ext === '.png') mediaType = 'image/png';
      else if (ext === '.gif') mediaType = 'image/gif';
      else if (ext === '.webp') mediaType = 'image/webp';
      else mediaType = 'image/jpeg'; // default for jpg, jpeg
    }

    // Call Claude Vision API
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Analysera detta kvitto och extrahera följande information i JSON-format:

{
  "supplier_name": "Leverantörens namn",
  "receipt_date": "YYYY-MM-DD",
  "amount": "Belopp exklusive moms (nummer)",
  "vat_amount": "Momsbelopp (nummer)",
  "total_amount": "Totalbelopp inklusive moms (nummer)",
  "category": "Kategori (t.ex. 'Mat', 'Transport', 'Kontorsmaterial', 'IT', etc)",
  "line_items": [
    {"description": "Artikelnamn", "amount": nummer}
  ],
  "confidence": "Din konfidensgrad 0-100"
}

Viktigt:
- Om kvittot är svenskt, belopp kan vara med SEK eller kr
- Datum ska vara i YYYY-MM-DD format
- Belopp ska vara nummer utan valuta-tecken
- Confidence är hur säker du är på extraktionen (0-100)
- Om något värde inte kan läsas, sätt null
- Svara ENDAST med JSON, ingen annan text`
            }
          ]
        }
      ]
    });

    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const data = JSON.parse(jsonMatch[0]);

    return {
      supplier_name: data.supplier_name || undefined,
      receipt_date: data.receipt_date || undefined,
      amount: data.amount ? parseFloat(data.amount) : undefined,
      vat_amount: data.vat_amount ? parseFloat(data.vat_amount) : undefined,
      total_amount: data.total_amount ? parseFloat(data.total_amount) : undefined,
      category: data.category || undefined,
      line_items: data.line_items || [],
      confidence: data.confidence || 50
    };
  } catch (error) {
    console.error('OCR extraction error:', error);
    throw new Error(`Failed to extract receipt data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Categorize an expense using AI
 * @param description - Description of the expense
 * @returns Category name
 */
export const categorizeExpense = async (description: string): Promise<string> => {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Kategorisera denna utgift i en av dessa kategorier: Mat, Transport, Kontorsmaterial, IT, Marknadsföring, Konsulter, Lokaler, Övrigt.

Utgift: ${description}

Svara med ENDAST kategorin, inget annat.`
        }
      ]
    });

    const textContent = message.content.find(c => c.type === 'text');
    if (textContent && textContent.type === 'text') {
      return textContent.text.trim();
    }

    return 'Övrigt';
  } catch (error) {
    console.error('Categorization error:', error);
    return 'Övrigt';
  }
};

/**
 * Get AI-powered accounting suggestions for a transaction
 * @param description - Transaction description
 * @param amount - Transaction amount
 * @param type - Transaction type (expense/revenue)
 * @returns Suggested BAS account number and reasoning
 */
export const suggestAccountingEntry = async (
  description: string,
  amount: number,
  type: 'expense' | 'revenue'
): Promise<{ account: number; reasoning: string }> => {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Du är en svensk redovisningsexpert. Föreslå vilket BAS-konto som ska användas för denna transaktion.

Typ: ${type === 'expense' ? 'Kostnad' : 'Intäkt'}
Beskrivning: ${description}
Belopp: ${amount} SEK

Vanliga BAS-konton:
Kostnader:
- 4000: Inköp varor
- 5010: Lokalhyra
- 5800: Representation
- 6071: Personalkostnader
- 6570: Bankkostnader
- 6980: Övriga externa kostnader

Intäkter:
- 3000: Försäljning varor 25% moms
- 3100: Försäljning tjänster 25% moms

Svara i JSON-format:
{
  "account": kontonummer,
  "reasoning": "Kort förklaring"
}`
        }
      ]
    });

    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return { account: type === 'expense' ? 6980 : 3100, reasoning: 'Default account' };
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { account: type === 'expense' ? 6980 : 3100, reasoning: 'Default account' };
    }

    const data = JSON.parse(jsonMatch[0]);
    return {
      account: parseInt(data.account),
      reasoning: data.reasoning || 'AI suggestion'
    };
  } catch (error) {
    console.error('Accounting suggestion error:', error);
    return {
      account: type === 'expense' ? 6980 : 3100,
      reasoning: 'Default account (AI error)'
    };
  }
};
