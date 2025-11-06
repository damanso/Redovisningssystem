import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {CustomerStackParamList} from '../types';
import CustomerListScreen from '../screens/customers/CustomerListScreen';
import CustomerDetailScreen from '../screens/customers/CustomerDetailScreen';
import CustomerCreateScreen from '../screens/customers/CustomerCreateScreen';

const Stack = createStackNavigator<CustomerStackParamList>();

const CustomerNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#007AFF',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}>
      <Stack.Screen
        name="CustomerList"
        component={CustomerListScreen}
        options={{title: 'Customers'}}
      />
      <Stack.Screen
        name="CustomerDetail"
        component={CustomerDetailScreen}
        options={{title: 'Customer Details'}}
      />
      <Stack.Screen
        name="CustomerCreate"
        component={CustomerCreateScreen}
        options={{title: 'Add Customer'}}
      />
      <Stack.Screen
        name="CustomerEdit"
        component={CustomerCreateScreen}
        options={{title: 'Edit Customer'}}
      />
    </Stack.Navigator>
  );
};

export default CustomerNavigator;
