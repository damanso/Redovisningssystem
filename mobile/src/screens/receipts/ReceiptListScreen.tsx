import React, {useEffect} from 'react';
import {View, Text, StyleSheet, FlatList, TouchableOpacity, Image} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {ReceiptStackParamList} from '../../types';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import {format} from 'date-fns';

type NavigationProp = StackNavigationProp<ReceiptStackParamList, 'ReceiptList'>;

// Mock data for demonstration
const mockReceipts = [
  {
    id: '1',
    description: 'Office Supplies',
    amount: 599.00,
    vatAmount: 119.80,
    date: new Date().toISOString(),
    category: 'Office',
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const ReceiptListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('sv-SE', {minimumFractionDigits: 2})} SEK`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return '#34C759';
      case 'pending':
        return '#FF9500';
      case 'rejected':
        return '#FF3B30';
      default:
        return '#8E8E93';
    }
  };

  const renderReceipt = ({item}: {item: typeof mockReceipts[0]}) => (
    <Card onPress={() => navigation.navigate('ReceiptDetail', {receiptId: item.id})}>
      <View style={styles.receiptCard}>
        <View style={styles.receiptIcon}>
          <Icon name="receipt" size={24} color="#007AFF" />
        </View>
        <View style={styles.receiptInfo}>
          <Text style={styles.receiptDescription}>{item.description}</Text>
          <Text style={styles.receiptDate}>
            {format(new Date(item.date), 'MMM dd, yyyy')}
          </Text>
          <Text style={styles.receiptCategory}>{item.category}</Text>
        </View>
        <View style={styles.receiptRight}>
          <Text style={styles.receiptAmount}>{formatCurrency(item.amount)}</Text>
          <View style={[styles.statusBadge, {backgroundColor: getStatusColor(item.status)}]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={mockReceipts}
        renderItem={renderReceipt}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="No Receipts"
            message="Scan your first receipt to get started"
          />
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('ReceiptScan')}>
        <Icon name="camera" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  list: {
    padding: 16,
  },
  receiptCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  receiptIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E5F1FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  receiptInfo: {
    flex: 1,
  },
  receiptDescription: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  receiptDate: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 2,
  },
  receiptCategory: {
    fontSize: 12,
    color: '#C7C7CC',
  },
  receiptRight: {
    alignItems: 'flex-end',
  },
  receiptAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
    textTransform: 'uppercase',
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

export default ReceiptListScreen;
