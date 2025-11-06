import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {InvoiceStackParamList} from '../types';
import InvoiceListScreen from '../screens/invoices/InvoiceListScreen';
import InvoiceDetailScreen from '../screens/invoices/InvoiceDetailScreen';
import InvoiceCreateScreen from '../screens/invoices/InvoiceCreateScreen';

const Stack = createStackNavigator<InvoiceStackParamList>();

const InvoiceNavigator: React.FC = () => {
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
        name="InvoiceList"
        component={InvoiceListScreen}
        options={{title: 'Invoices'}}
      />
      <Stack.Screen
        name="InvoiceDetail"
        component={InvoiceDetailScreen}
        options={{title: 'Invoice Details'}}
      />
      <Stack.Screen
        name="InvoiceCreate"
        component={InvoiceCreateScreen}
        options={{title: 'Create Invoice'}}
      />
      <Stack.Screen
        name="InvoiceEdit"
        component={InvoiceCreateScreen}
        options={{title: 'Edit Invoice'}}
      />
    </Stack.Navigator>
  );
};

export default InvoiceNavigator;
