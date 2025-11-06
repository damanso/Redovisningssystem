import React, {useEffect} from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {CustomerStackParamList} from '../../types';
import {useCustomerStore} from '../../store/customerStore';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Loading from '../../components/Loading';

type NavigationProp = StackNavigationProp<CustomerStackParamList, 'CustomerDetail'>;
type RoutePropType = RouteProp<CustomerStackParamList, 'CustomerDetail'>;

const CustomerDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const {customerId} = route.params;

  const {selectedCustomer, isLoading, fetchCustomer, deleteCustomer} = useCustomerStore();

  useEffect(() => {
    fetchCustomer(customerId);
  }, [customerId]);

  const handleDelete = () => {
    Alert.alert(
      'Delete Customer',
      'Are you sure you want to delete this customer?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCustomer(customerId);
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete customer');
            }
          },
        },
      ],
    );
  };

  if (isLoading || !selectedCustomer) {
    return <Loading />;
  }

  const InfoRow = ({icon, label, value}: {icon: string; label: string; value: string}) => (
    <View style={styles.infoRow}>
      <Icon name={icon} size={20} color="#007AFF" style={styles.infoIcon} />
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {selectedCustomer.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.customerName}>{selectedCustomer.name}</Text>
        <Text style={styles.orgNumber}>{selectedCustomer.organizationNumber}</Text>
      </View>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Information</Text>
        <InfoRow icon="mail" label="Email" value={selectedCustomer.email} />
        <InfoRow icon="call" label="Phone" value={selectedCustomer.phone} />
        {selectedCustomer.contactPerson && (
          <InfoRow
            icon="person"
            label="Contact Person"
            value={selectedCustomer.contactPerson}
          />
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Address</Text>
        <InfoRow icon="location" label="Street" value={selectedCustomer.address} />
        <InfoRow
          icon="location"
          label="City"
          value={`${selectedCustomer.postalCode} ${selectedCustomer.city}`}
        />
        <InfoRow icon="globe" label="Country" value={selectedCustomer.country} />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Payment Terms</Text>
        <InfoRow
          icon="calendar"
          label="Payment Terms"
          value={`${selectedCustomer.paymentTerms} days`}
        />
      </Card>

      {selectedCustomer.notes && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.notes}>{selectedCustomer.notes}</Text>
        </Card>
      )}

      <View style={styles.actions}>
        <Button
          title="Edit Customer"
          onPress={() => navigation.navigate('CustomerEdit', {customerId})}
          style={styles.button}
        />
        <Button
          title="Delete Customer"
          onPress={handleDelete}
          variant="danger"
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
  header: {
    backgroundColor: '#fff',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  customerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  orgNumber: {
    fontSize: 14,
    color: '#8E8E93',
  },
  section: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  infoIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#000',
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

export default CustomerDetailScreen;
