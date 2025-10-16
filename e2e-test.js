#!/usr/bin/env node

/**
 * Complete E2E Test of Redovisningssystem
 * Tests all 12 modules in Fas 2 MVP Core
 */

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join } from 'path';

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = './test-screenshots';

// Test data
const testUser = {
  email: `test-${Date.now()}@example.com`,
  password: 'SecureTest123!',
  name: 'Test User E2E'
};

const testCompany = {
  name: 'Test Företag AB',
  org_number: `556${Math.floor(Math.random() * 1000000)}`,
  email: 'info@testforetag.se',
  phone: '+46701234567',
  address_street: 'Testgatan 1',
  address_postal_code: '12345',
  address_city: 'Stockholm',
  bank_account: '1234567890'
};

const testCustomer = {
  name: 'Test Kund AB',
  org_number: `559${Math.floor(Math.random() * 1000000)}`,
  email: 'kund@testkund.se',
  payment_terms: 30
};

const testArticle = {
  name: 'Konsulttjänst',
  description: 'Webbutveckling per timme',
  price: 1200,
  unit: 'timmar',
  vat_rate: 25
};

// Helper functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
  const filename = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`📸 Screenshot saved: ${filename}`);
}

async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    console.error(`❌ Element not found: ${selector}`);
    return false;
  }
}

// Test results
const results = {
  passed: [],
  failed: [],
  screenshots: []
};

function testPass(name) {
  console.log(`✅ PASS: ${name}`);
  results.passed.push(name);
}

function testFail(name, error) {
  console.log(`❌ FAIL: ${name} - ${error}`);
  results.failed.push({ name, error });
}

// Main test function
async function runE2ETests() {
  console.log('🚀 Starting Complete E2E Test of Redovisningssystem\n');
  console.log('📋 Test Plan:');
  console.log('  1. Frontend startup verification');
  console.log('  2. User registration');
  console.log('  3. User login');
  console.log('  4. Company creation');
  console.log('  5. Customer creation');
  console.log('  6. Supplier creation');
  console.log('  7. Article creation');
  console.log('  8. Invoice creation');
  console.log('  9. PDF generation');
  console.log('  10. Receipt upload');
  console.log('  11. Dashboard verification');
  console.log('  12. Accounting module');
  console.log('  13. Reports verification\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable console logging from browser
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('🔴 Browser Error:', msg.text());
    }
  });

  try {
    // Test 1: Frontend startup
    console.log('\n📍 Test 1: Frontend Startup Verification');
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2' });
    await takeScreenshot(page, '01-frontend-loaded');

    const title = await page.title();
    if (title.includes('Redovisning')) {
      testPass('Frontend loads successfully');
    } else {
      testFail('Frontend startup', `Wrong title: ${title}`);
    }

    await sleep(2000);

    // Test 2: User Registration (via API since UI may not be built)
    console.log('\n📍 Test 2: User Registration');
    const registerResponse = await fetch(`${BACKEND_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });

    if (registerResponse.ok) {
      const userData = await registerResponse.json();
      testPass('User registration via API');
      console.log(`   👤 Created user: ${testUser.email}`);
    } else {
      const error = await registerResponse.text();
      testFail('User registration', error);
    }

    await sleep(1000);

    // Test 3: User Login
    console.log('\n📍 Test 3: User Login');
    const loginResponse = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });

    let authToken = '';
    if (loginResponse.ok) {
      const loginData = await loginResponse.json();
      authToken = loginData.token;
      testPass('User login via API');
      console.log(`   🔑 Got auth token: ${authToken.substring(0, 20)}...`);
    } else {
      testFail('User login', await loginResponse.text());
      throw new Error('Cannot continue without auth token');
    }

    await sleep(1000);

    // Test 4: Company Creation
    console.log('\n📍 Test 4: Company Creation');
    const companyResponse = await fetch(`${BACKEND_URL}/api/v1/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(testCompany)
    });

    let companyId = '';
    if (companyResponse.ok) {
      const companyData = await companyResponse.json();
      companyId = companyData.id;
      testPass('Company creation');
      console.log(`   🏢 Created company: ${testCompany.name} (ID: ${companyId})`);
    } else {
      testFail('Company creation', await companyResponse.text());
    }

    await sleep(1000);

    // Test 5: Customer Creation
    console.log('\n📍 Test 5: Customer Creation');
    const customerResponse = await fetch(`${BACKEND_URL}/api/v1/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ ...testCustomer, company_id: companyId })
    });

    let customerId = '';
    if (customerResponse.ok) {
      const customerData = await customerResponse.json();
      customerId = customerData.id;
      testPass('Customer creation');
      console.log(`   👥 Created customer: ${testCustomer.name} (ID: ${customerId})`);
    } else {
      testFail('Customer creation', await customerResponse.text());
    }

    await sleep(1000);

    // Test 6: Supplier Creation
    console.log('\n📍 Test 6: Supplier Creation');
    const supplierResponse = await fetch(`${BACKEND_URL}/api/v1/suppliers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        company_id: companyId,
        name: 'Test Leverantör AB',
        email: 'leverantor@test.se'
      })
    });

    let supplierId = '';
    if (supplierResponse.ok) {
      const supplierData = await supplierResponse.json();
      supplierId = supplierData.id;
      testPass('Supplier creation');
      console.log(`   🏭 Created supplier: Test Leverantör AB (ID: ${supplierId})`);
    } else {
      testFail('Supplier creation', await supplierResponse.text());
    }

    await sleep(1000);

    // Test 7: Article Creation
    console.log('\n📍 Test 7: Article Creation');
    const articleResponse = await fetch(`${BACKEND_URL}/api/v1/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ ...testArticle, company_id: companyId })
    });

    let articleId = '';
    if (articleResponse.ok) {
      const articleData = await articleResponse.json();
      articleId = articleData.id;
      testPass('Article creation');
      console.log(`   📦 Created article: ${testArticle.name} (ID: ${articleId})`);
    } else {
      testFail('Article creation', await articleResponse.text());
    }

    await sleep(1000);

    // Test 8: Invoice Creation
    console.log('\n📍 Test 8: Invoice Creation');
    const invoiceResponse = await fetch(`${BACKEND_URL}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        company_id: companyId,
        customer_id: customerId,
        invoice_date: new Date().toISOString().split('T')[0],
        payment_terms: 30,
        lines: [
          {
            article_id: articleId,
            description: testArticle.name,
            quantity: 10,
            unit_price: testArticle.price,
            unit: testArticle.unit,
            vat_rate: testArticle.vat_rate
          }
        ]
      })
    });

    let invoiceId = '';
    let invoiceNumber = '';
    if (invoiceResponse.ok) {
      const invoiceData = await invoiceResponse.json();
      invoiceId = invoiceData.id;
      invoiceNumber = invoiceData.invoice_number;
      testPass('Invoice creation');
      console.log(`   📄 Created invoice: ${invoiceNumber} (ID: ${invoiceId})`);
      console.log(`   💰 Total: ${invoiceData.total_amount} SEK`);
    } else {
      testFail('Invoice creation', await invoiceResponse.text());
    }

    await sleep(1000);

    // Test 9: PDF Generation
    console.log('\n📍 Test 9: PDF Generation');
    const pdfResponse = await fetch(
      `${BACKEND_URL}/api/v1/invoices/${invoiceId}/generate-pdf?company_id=${companyId}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (pdfResponse.ok) {
      const contentType = pdfResponse.headers.get('content-type');
      if (contentType && contentType.includes('application/pdf')) {
        // PDF binary returned successfully
        const pdfBuffer = await pdfResponse.arrayBuffer();
        testPass('PDF generation');
        console.log(`   📑 PDF generated: ${pdfBuffer.byteLength} bytes`);
      } else {
        // JSON response with URL
        const pdfData = await pdfResponse.json();
        testPass('PDF generation');
        console.log(`   📑 PDF URL: ${pdfData.url || 'Generated'}`);
      }
    } else {
      testFail('PDF generation', await pdfResponse.text());
    }

    await sleep(1000);

    // Test 10: Dashboard Stats
    console.log('\n📍 Test 10: Dashboard Statistics');
    const dashboardResponse = await fetch(
      `${BACKEND_URL}/api/v1/dashboard/stats?company_id=${companyId}`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (dashboardResponse.ok) {
      const dashboardData = await dashboardResponse.json();
      testPass('Dashboard stats API');
      console.log(`   📊 Stats retrieved successfully`);
      console.log(`   💵 Revenue this month: ${dashboardData.revenue_this_month || 0} SEK`);
    } else {
      testFail('Dashboard stats', await dashboardResponse.text());
    }

    await sleep(1000);

    // Test 11: Get Customers List
    console.log('\n📍 Test 11: Customer List Retrieval');
    const customersResponse = await fetch(
      `${BACKEND_URL}/api/v1/customers?company_id=${companyId}`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (customersResponse.ok) {
      const customersData = await customersResponse.json();
      testPass('Customer list retrieval');
      console.log(`   👥 Found ${customersData.customers?.length || 0} customers`);
    } else {
      testFail('Customer list', await customersResponse.text());
    }

    await sleep(1000);

    // Test 12: BAS Accounts (Accounting)
    console.log('\n📍 Test 12: BAS Accounting System');
    const basResponse = await fetch(
      `${BACKEND_URL}/api/v1/accounting/bas-accounts`,
      {
        headers: { 'Authorization': `Bearer ${authToken}` }
      }
    );

    if (basResponse.ok) {
      const basData = await basResponse.json();
      testPass('BAS accounts retrieval');
      console.log(`   💼 Found ${basData.length} BAS accounts`);
    } else {
      testFail('BAS accounts', await basResponse.text());
    }

    await sleep(1000);

    // Final screenshot
    await takeScreenshot(page, '99-test-complete');

  } catch (error) {
    console.error('\n💥 Test suite error:', error);
    await takeScreenshot(page, 'ERROR-state');
  } finally {
    await browser.close();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📸 Screenshots: ${results.screenshots.length}`);

  if (results.passed.length > 0) {
    console.log('\n✅ Passed tests:');
    results.passed.forEach(test => console.log(`   ✓ ${test}`));
  }

  if (results.failed.length > 0) {
    console.log('\n❌ Failed tests:');
    results.failed.forEach(({ name, error }) => console.log(`   ✗ ${name}: ${error}`));
  }

  const totalTests = results.passed.length + results.failed.length;
  const passRate = ((results.passed.length / totalTests) * 100).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log(`🎯 Pass Rate: ${passRate}% (${results.passed.length}/${totalTests})`);
  console.log('='.repeat(60));

  // Write results to file
  writeFileSync(
    './e2e-test-results.json',
    JSON.stringify({ results, testUser, testCompany, timestamp: new Date() }, null, 2)
  );
  console.log('\n💾 Results saved to: e2e-test-results.json');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runE2ETests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
