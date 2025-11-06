import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import {CustomerStackParamList, Customer} from '../../types';
import {useCustomerStore} from '../../store/customerStore';
import Card from '../../components/Card';
import Loading from '../../components/Loading';
import EmptyState from '../../components/EmptyState';

type NavigationProp = StackNavigationProp<CustomerStackParamList, 'CustomerList'>;

const CustomerListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const {customers, isLoading, fetchCustomers, searchCustomers} = useCustomerStore();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (searchQuery.trim()) {
        searchCustomers(searchQuery);
      } else {
        fetchCustomers();
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleRefresh = () => {
    setSearchQuery('');
    fetchCustomers(true);
  };

  const renderCustomer = ({item}: {item: Customer}) => (
    <Card
      onPress={() =>
        navigation.navigate('CustomerDetail', {customerId: item.id})
      }>
      <View style={styles.customerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.customerInfo}>
          <Text style={styles.customerName}>{item.name}</Text>
          <Text style={styles.customerDetails}>
            {item.email} • {item.phone}
          </Text>
          <Text style={styles.customerLocation}>
            {item.city}, {item.country}
          </Text>
        </View>
        <Icon name="chevron-forward" size={24} color="#C7C7CC" />
      </View>
    </Card>
  );

  if (isLoading && customers.length === 0) {
    return <Loading />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Icon
          name="search"
          size={20}
          color="#8E8E93"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#8E8E93"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Icon name="close-circle" size={20} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={customers}
        renderItem={renderCustomer}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No Customers"
            message="Add your first customer to get started"
          />
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CustomerCreate')}>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    color: '#000',
  },
  list: {
    padding: 16,
    paddingTop: 0,
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  customerInfo: {
    flex: 1,
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
  customerLocation: {
    fontSize: 12,
    color: '#C7C7CC',
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

export default CustomerListScreen;
