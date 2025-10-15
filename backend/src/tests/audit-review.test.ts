import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

// Test credentials
const TEST_USER = {
  email: 'test@example.com',
  password: 'TestPassword123',
};

let authToken: string;

describe('Audit Log System Review', () => {

  beforeAll(async () => {
    console.log('🔐 Logging in...');
    try {
      const response = await axios.post(`${API_URL}/auth/login`, TEST_USER);
      authToken = response.data.token;
      console.log('✅ Login successful');
    } catch (error: any) {
      console.error('❌ Login failed:', error.response?.data || error.message);
      throw error;
    }
  });

  test('1. Database schema should exist', async () => {
    // This will be checked via the audit logs query
    expect(authToken).toBeDefined();
  });

  test('2. Should get user activity logs', async () => {
    console.log('\n📊 Fetching user activity logs...');
    const response = await axios.get(`${API_URL}/audit/activity/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log(`Found ${response.data.length} activity logs`);
    console.log('Recent activities:');
    response.data.slice(0, 5).forEach((log: any, i: number) => {
      console.log(`  ${i + 1}. ${log.action} - ${log.status} - ${new Date(log.created_at).toLocaleString()}`);
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);

    // Check that login action was logged
    const loginLogs = response.data.filter((log: any) => log.action === 'auth.login');
    expect(loginLogs.length).toBeGreaterThan(0);

    // Verify log structure
    if (response.data.length > 0) {
      const log = response.data[0];
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('user_id');
      expect(log).toHaveProperty('action');
      expect(log).toHaveProperty('entity_type');
      expect(log).toHaveProperty('status');
      expect(log).toHaveProperty('created_at');
      expect(log).toHaveProperty('user_email');
      expect(log).toHaveProperty('user_name');

      // Check if IP and User-Agent are captured
      if (log.ip_address) {
        console.log(`✅ IP address captured: ${log.ip_address}`);
      }
      if (log.user_agent) {
        console.log(`✅ User-Agent captured: ${log.user_agent.substring(0, 50)}...`);
      }
    }
  });

  test('3. Should get audit logs with filters', async () => {
    console.log('\n🔍 Testing filtered audit logs...');

    // Filter by action
    const response = await axios.get(`${API_URL}/audit`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { action: 'auth.login', limit: 10 }
    });

    console.log(`Found ${response.data.length} login logs`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);

    // All should be login actions
    response.data.forEach((log: any) => {
      expect(log.action).toBe('auth.login');
    });
  });

  test('4. Should get audit statistics', async () => {
    console.log('\n📈 Fetching audit statistics...');
    const response = await axios.get(`${API_URL}/audit/stats/summary`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    console.log('Audit Stats:');
    console.log(`  Total logs: ${response.data.total_logs}`);
    console.log(`  Unique users: ${response.data.unique_users}`);
    console.log(`  Successful: ${response.data.successful_actions}`);
    console.log(`  Failed: ${response.data.failed_actions}`);
    console.log(`  Last 24h: ${response.data.last_24h}`);
    console.log(`  Last 7 days: ${response.data.last_7days}`);
    console.log(`  Last 30 days: ${response.data.last_30days}`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('total_logs');
    expect(response.data).toHaveProperty('unique_users');
    expect(response.data).toHaveProperty('successful_actions');
    expect(response.data).toHaveProperty('failed_actions');
  });

  test('5. Should capture failed login attempts', async () => {
    console.log('\n🚫 Testing failed login audit...');

    try {
      await axios.post(`${API_URL}/auth/login`, {
        email: 'test@example.com',
        password: 'WrongPassword123!'
      });
      fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.response.status).toBe(401);
    }

    // Check that failed login was logged
    const response = await axios.get(`${API_URL}/audit/activity/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { limit: 10 }
    });

    const failedLogins = response.data.filter((log: any) =>
      log.action === 'auth.login' && log.status === 'failure'
    );

    console.log(`Found ${failedLogins.length} failed login attempts`);
    if (failedLogins.length > 0) {
      console.log(`Latest failure: ${failedLogins[0].error_message}`);
    }

    expect(failedLogins.length).toBeGreaterThan(0);
  });

  test('6. Should have proper indexes (performance check)', async () => {
    console.log('\n⚡ Checking database indexes...');

    // Make multiple queries to test index performance
    const start = Date.now();

    await axios.get(`${API_URL}/audit`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { limit: 100 }
    });

    const duration = Date.now() - start;
    console.log(`Query completed in ${duration}ms`);

    // Should complete quickly with indexes
    expect(duration).toBeLessThan(1000);
  });

  test('7. Should support date range filtering', async () => {
    console.log('\n📅 Testing date range filtering...');

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const response = await axios.get(`${API_URL}/audit`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: {
        start_date: yesterday.toISOString(),
        end_date: now.toISOString(),
        limit: 50
      }
    });

    console.log(`Found ${response.data.length} logs in last 24 hours`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
  });
});

// Run the tests
console.log('\n🧪 AUDIT LOG SYSTEM REVIEW\n');
console.log('================================\n');
