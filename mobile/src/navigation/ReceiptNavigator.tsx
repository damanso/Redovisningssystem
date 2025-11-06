import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {ReceiptStackParamList} from '../types';
import ReceiptListScreen from '../screens/receipts/ReceiptListScreen';
import ReceiptDetailScreen from '../screens/receipts/ReceiptDetailScreen';
import ReceiptScanScreen from '../screens/receipts/ReceiptScanScreen';

const Stack = createStackNavigator<ReceiptStackParamList>();

const ReceiptNavigator: React.FC = () => {
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
        name="ReceiptList"
        component={ReceiptListScreen}
        options={{title: 'Receipts'}}
      />
      <Stack.Screen
        name="ReceiptDetail"
        component={ReceiptDetailScreen}
        options={{title: 'Receipt Details'}}
      />
      <Stack.Screen
        name="ReceiptScan"
        component={ReceiptScanScreen}
        options={{title: 'Scan Receipt'}}
      />
    </Stack.Navigator>
  );
};

export default ReceiptNavigator;
