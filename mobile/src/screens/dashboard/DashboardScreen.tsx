import React, {useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useDashboardStore} from '../../store/dashboardStore';
import {useAuthStore} from '../../store/authStore';
import Card from '../../components/Card';
import Loading from '../../components/Loading';
import {format} from 'date-fns';

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation();
  const {user} = useAuthStore();
  const {stats, isLoading, fetchStats} = useDashboardStore();

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRefresh = () => {
    fetchStats(true);
  };

  if (isLoading && !stats) {
    return <Loading />;
  }

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('sv-SE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} SEK`;
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />
      }>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hello, {user?.firstName || 'User'}!
        </Text>
        <Text style={styles.subtitle}>Here's your business overview</Text>
      </View>

      {/* Statistics Cards */}
      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <Icon name="trending-up" size={32} color="#34C759" />
          <Text style={styles.statValue}>
            {stats ? formatCurrency(stats.totalRevenue) : '-'}
          </Text>
          <Text style={styles.statLabel}>Total Revenue</Text>
        </Card>

        <Card style={styles.statCard}>
          <Icon name="trending-down" size={32} color="#FF3B30" />
          <Text style={styles.statValue}>
            {stats ? formatCurrency(stats.totalExpenses) : '-'}
          </Text>
          <Text style={styles.statLabel}>Total Expenses</Text>
        </Card>

        <Card style={styles.statCard}>
          <Icon name="document-text" size={32} color="#007AFF" />
          <Text style={styles.statValue}>
            {stats?.pendingInvoices || 0}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </Card>

        <Card style={styles.statCard}>
          <Icon name="alert-circle" size={32} color="#FF9500" />
          <Text style={styles.statValue}>
            {stats?.overdueInvoices || 0}
          </Text>
          <Text style={styles.statLabel}>Overdue</Text>
        </Card>
      </View>

      {/* Recent Invoices */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Invoices</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Invoices' as never)}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>

        {stats?.recentInvoices && stats.recentInvoices.length > 0 ? (
          stats.recentInvoices.slice(0, 5).map(invoice => (
            <Card key={invoice.id} style={styles.invoiceCard}>
              <View style={styles.invoiceHeader}>
                <Text style={styles.invoiceNumber}>
                  {invoice.invoiceNumber}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    styles[`status${invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}`],
                  ]}>
                  <Text style={styles.statusText}>{invoice.status}</Text>
                </View>
              </View>
              <Text style={styles.customerName}>
                {invoice.customer?.name || 'Unknown Customer'}
              </Text>
              <View style={styles.invoiceFooter}>
                <Text style={styles.invoiceAmount}>
                  {formatCurrency(invoice.totalAmount)}
                </Text>
                <Text style={styles.invoiceDate}>
                  Due: {format(new Date(invoice.dueDate), 'MMM dd, yyyy')}
                </Text>
              </View>
            </Card>
          ))
        ) : (
          <Card>
            <Text style={styles.emptyText}>No recent invoices</Text>
          </Card>
        )}
      </View>

      {/* Top Customers */}
      {stats?.topCustomers && stats.topCustomers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Customers</Text>
          {stats.topCustomers.slice(0, 3).map((customer, index) => (
            <Card key={index} style={styles.customerCard}>
              <View style={styles.customerRank}>
                <Text style={styles.rankNumber}>{index + 1}</Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{customer.name}</Text>
                <Text style={styles.customerAmount}>
                  {formatCurrency(customer.amount)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
  },
  statCard: {
    width: '48%',
    margin: '1%',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  seeAll: {
    fontSize: 14,
    color: '#007AFF',
  },
  invoiceCard: {
    marginBottom: 8,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  invoiceNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusDraft: {
    backgroundColor: '#E5E5EA',
  },
  statusSent: {
    backgroundColor: '#007AFF',
  },
  statusPaid: {
    backgroundColor: '#34C759',
  },
  statusOverdue: {
    backgroundColor: '#FF3B30',
  },
  statusCancelled: {
    backgroundColor: '#8E8E93',
  },
  statusText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  customerName: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 8,
  },
  invoiceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  invoiceDate: {
    fontSize: 12,
    color: '#8E8E93',
  },
  emptyText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  customerRank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  customerInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customerAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
});

export default DashboardScreen;
