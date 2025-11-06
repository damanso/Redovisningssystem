import React, {useState} from 'react';
import {View, Text, StyleSheet, ScrollView, Alert} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useInvoiceStore} from '../../store/invoiceStore';
import {InvoiceForm, InvoiceItem} from '../../types';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Card from '../../components/Card';

const InvoiceCreateScreen: React.FC = () => {
  const navigation = useNavigation();
  const {createInvoice, isLoading} = useInvoiceStore();

  const [formData, setFormData] = useState<InvoiceForm>({
    customerId: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    items: [{
      description: '',
      quantity: 1,
      unitPrice: 0,
      vatRate: 25,
      total: 0,
    }],
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSave = async () => {
    // Basic validation
    if (!formData.customerId) {
      Alert.alert('Error', 'Please select a customer');
      return;
    }

    if (formData.items.length === 0 || !formData.items[0].description) {
      Alert.alert('Error', 'Please add at least one item');
      return;
    }

    try {
      await createInvoice(formData);
      Alert.alert('Success', 'Invoice created successfully');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to create invoice');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Invoice Information</Text>
        <Input
          label="Customer ID *"
          value={formData.customerId}
          onChangeText={text => setFormData(prev => ({...prev, customerId: text}))}
          placeholder="Enter customer ID"
        />
        <Input
          label="Issue Date *"
          value={formData.issueDate}
          onChangeText={text => setFormData(prev => ({...prev, issueDate: text}))}
          placeholder="YYYY-MM-DD"
        />
        <Input
          label="Due Date *"
          value={formData.dueDate}
          onChangeText={text => setFormData(prev => ({...prev, dueDate: text}))}
          placeholder="YYYY-MM-DD"
        />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        <Text style={styles.helpText}>
          Simplified invoice creation. Full functionality available in web version.
        </Text>
        <Input
          label="Description *"
          value={formData.items[0].description}
          onChangeText={text => {
            const items = [...formData.items];
            items[0].description = text;
            setFormData(prev => ({...prev, items}));
          }}
          placeholder="Item description"
        />
        <Input
          label="Quantity"
          value={formData.items[0].quantity.toString()}
          onChangeText={text => {
            const items = [...formData.items];
            items[0].quantity = parseInt(text) || 1;
            items[0].total = items[0].quantity * items[0].unitPrice;
            setFormData(prev => ({...prev, items}));
          }}
          keyboardType="number-pad"
        />
        <Input
          label="Unit Price"
          value={formData.items[0].unitPrice.toString()}
          onChangeText={text => {
            const items = [...formData.items];
            items[0].unitPrice = parseFloat(text) || 0;
            items[0].total = items[0].quantity * items[0].unitPrice;
            setFormData(prev => ({...prev, items}));
          }}
          keyboardType="decimal-pad"
        />
        <Input
          label="VAT Rate (%)"
          value={formData.items[0].vatRate.toString()}
          onChangeText={text => {
            const items = [...formData.items];
            items[0].vatRate = parseFloat(text) || 25;
            setFormData(prev => ({...prev, items}));
          }}
          keyboardType="decimal-pad"
        />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Notes</Text>
        <Input
          value={formData.notes}
          onChangeText={text => setFormData(prev => ({...prev, notes: text}))}
          placeholder="Additional notes"
          multiline
          numberOfLines={4}
          style={styles.notesInput}
        />
      </Card>

      <View style={styles.actions}>
        <Button
          title="Create Invoice"
          onPress={handleSave}
          loading={isLoading}
          style={styles.button}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  section: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  notesInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  actions: {
    padding: 16,
  },
  button: {
    marginBottom: 32,
  },
});

export default InvoiceCreateScreen;
