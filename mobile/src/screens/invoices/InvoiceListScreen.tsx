import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {InvoiceStackParamList, Invoice} from '../../types';
import {useInvoiceStore} from '../../store/invoiceStore';
import Card from '../../components/Card';
import Loading from '../../components/Loading';
import EmptyState from '../../components/EmptyState';
import {format} from 'date-fns';

type NavigationProp = StackNavigationProp<InvoiceStackParamList, 'InvoiceList'>;

const InvoiceListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const {invoices, isLoading, fetchInvoices} = useInvoiceStore();
  const [filter, setFilter] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetchInvoices(false, filter);
  }, [filter]);

  const handleRefresh = () => {
    fetchInvoices(true, filter);
  };

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('sv-SE', {minimumFractionDigits: 2})} SEK`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return '#34C759';
      case 'sent':
        return '#007AFF';
      case 'overdue':
        return '#FF3B30';
      case 'draft':
        return '#8E8E93';
      default:
        return '#C7C7CC';
    }
  };

  const renderInvoice = ({item}: {item: Invoice}) => (
    <Card onPress={() => navigation.navigate('InvoiceDetail', {invoiceId: item.id})}>
      <View style={styles.invoiceHeader}>
        <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
        <View style={[styles.statusBadge, {backgroundColor: getStatusColor(item.status)}]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.customerName}>{item.customer?.name || 'Unknown'}</Text>
      <View style={styles.invoiceFooter}>
        <Text style={styles.amount}>{formatCurrency(item.totalAmount)}</Text>
        <Text style={styles.date}>Due: {format(new Date(item.dueDate), 'MMM dd, yyyy')}</Text>
      </View>
    </Card>
  );

  if (isLoading && invoices.length === 0) {
    return <Loading />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        {['all', 'draft', 'sent', 'paid', 'overdue'].map(status => (
          <TouchableOpacity
            key={status}
            style={[styles.filterButton, filter === (status === 'all' ? undefined : status) && styles.filterButtonActive]}
            onPress={() => setFilter(status === 'all' ? undefined : status)}>
            <Text
              style={[
                styles.filterText,
                filter === (status === 'all' ? undefined : status) && styles.filterTextActive,
              ]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={invoices}
        renderItem={renderInvoice}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title="No Invoices"
            message="Create your first invoice to get started"
          />
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('InvoiceCreate')}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginHorizontal: 4,
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    padding: 16,
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
  statusText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    textTransform: 'uppercase',
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
  amount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  date: {
    fontSize: 12,
    color: '#8E8E93',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});

export default InvoiceListScreen;
