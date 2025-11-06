import React, {useEffect} from 'react';
import {View, Text, StyleSheet, ScrollView, Alert} from 'react-native';
import {useRoute, RouteProp, useNavigation} from '@react-navigation/native';
import {InvoiceStackParamList} from '../../types';
import {useInvoiceStore} from '../../store/invoiceStore';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Loading from '../../components/Loading';
import {format} from 'date-fns';

type RoutePropType = RouteProp<InvoiceStackParamList, 'InvoiceDetail'>;

const InvoiceDetailScreen: React.FC = () => {
  const route = useRoute<RoutePropType>();
  const navigation = useNavigation();
  const {invoiceId} = route.params;

  const {selectedInvoice, isLoading, fetchInvoice, sendInvoice, markAsPaid, deleteInvoice} =
    useInvoiceStore();

  useEffect(() => {
    fetchInvoice(invoiceId);
  }, [invoiceId]);

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('sv-SE', {minimumFractionDigits: 2})} SEK`;
  };

  const handleSend = async () => {
    try {
      await sendInvoice(invoiceId);
      Alert.alert('Success', 'Invoice sent successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to send invoice');
    }
  };

  const handleMarkPaid = async () => {
    try {
      await markAsPaid(invoiceId);
      Alert.alert('Success', 'Invoice marked as paid');
    } catch (error) {
      Alert.alert('Error', 'Failed to mark invoice as paid');
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Invoice', 'Are you sure you want to delete this invoice?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteInvoice(invoiceId);
            navigation.goBack();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete invoice');
          }
        },
      },
    ]);
  };

  if (isLoading || !selectedInvoice) {
    return <Loading />;
  }

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.header}>
        <Text style={styles.invoiceNumber}>{selectedInvoice.invoiceNumber}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{selectedInvoice.status}</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Customer</Text>
        <Text style={styles.customerName}>{selectedInvoice.customer?.name || 'Unknown'}</Text>
        <Text style={styles.customerDetails}>{selectedInvoice.customer?.email}</Text>
        <Text style={styles.customerDetails}>{selectedInvoice.customer?.phone}</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Dates</Text>
        <View style={styles.dateRow}>
          <Text style={styles.dateLabel}>Issue Date:</Text>
          <Text style={styles.dateValue}>
            {format(new Date(selectedInvoice.issueDate), 'MMM dd, yyyy')}
          </Text>
        </View>
        <View style={styles.dateRow}>
          <Text style={styles.dateLabel}>Due Date:</Text>
          <Text style={styles.dateValue}>
            {format(new Date(selectedInvoice.dueDate), 'MMM dd, yyyy')}
          </Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Items</Text>
        {selectedInvoice.items.map((item, index) => (
          <View key={index} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemDescription}>{item.description}</Text>
              <Text style={styles.itemDetails}>
                {item.quantity} x {formatCurrency(item.unitPrice)} (VAT {item.vatRate}%)
              </Text>
            </View>
            <Text style={styles.itemTotal}>{formatCurrency(item.total)}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal:</Text>
          <Text style={styles.totalValue}>{formatCurrency(selectedInvoice.subtotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>VAT:</Text>
          <Text style={styles.totalValue}>{formatCurrency(selectedInvoice.vatAmount)}</Text>
        </View>
        <View style={[styles.totalRow, styles.grandTotal]}>
          <Text style={styles.grandTotalLabel}>Total:</Text>
          <Text style={styles.grandTotalValue}>{formatCurrency(selectedInvoice.totalAmount)}</Text>
        </View>
      </Card>

      {selectedInvoice.notes && (
        <Card>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.notes}>{selectedInvoice.notes}</Text>
        </Card>
      )}

      <View style={styles.actions}>
        {selectedInvoice.status === 'draft' && (
          <Button title="Send Invoice" onPress={handleSend} style={styles.button} />
        )}
        {selectedInvoice.status === 'sent' && (
          <Button title="Mark as Paid" onPress={handleMarkPaid} variant="primary" style={styles.button} />
        )}
        <Button
          title="Edit Invoice"
          onPress={() => navigation.navigate('InvoiceEdit' as never, {invoiceId} as never)}
          variant="secondary"
          style={styles.button}
        />
        <Button title="Delete Invoice" onPress={handleDelete} variant="danger" style={styles.button} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: 16,
  },
  invoiceNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#007AFF',
  },
  statusText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  customerDetails: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 2,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dateLabel: {
    fontSize: 14,
    color: '#8E8E93',
  },
  dateValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemDescription: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: '#8E8E93',
  },
  itemTotal: {
    fontSize: 14,
    color: '#000',
    fontWeight: '600',
    marginLeft: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 14,
    color: '#8E8E93',
  },
  totalValue: {
    fontSize: 14,
    color: '#000',
  },
  grandTotal: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  grandTotalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  grandTotalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  notes: {
    fontSize: 14,
    color: '#000',
    lineHeight: 20,
  },
  actions: {
    padding: 16,
  },
  button: {
    marginBottom: 12,
  },
});

export default InvoiceDetailScreen;
