import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import {MainTabParamList} from '../types';

// Import screen navigators
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import InvoiceNavigator from './InvoiceNavigator';
import CustomerNavigator from './CustomerNavigator';
import ReceiptNavigator from './ReceiptNavigator';
import MoreScreen from '../screens/more/MoreScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

const MainNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        tabBarIcon: ({focused, color, size}) => {
          let iconName: string = 'home';

          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Invoices':
              iconName = focused ? 'document-text' : 'document-text-outline';
              break;
            case 'Customers':
              iconName = focused ? 'people' : 'people-outline';
              break;
            case 'Receipts':
              iconName = focused ? 'camera' : 'camera-outline';
              break;
            case 'More':
              iconName = focused ? 'menu' : 'menu-outline';
              break;
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
        headerStyle: {
          backgroundColor: '#007AFF',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{title: 'Dashboard'}}
      />
      <Tab.Screen
        name="Invoices"
        component={InvoiceNavigator}
        options={{headerShown: false}}
      />
      <Tab.Screen
        name="Customers"
        component={CustomerNavigator}
        options={{headerShown: false}}
      />
      <Tab.Screen
        name="Receipts"
        component={ReceiptNavigator}
        options={{headerShown: false}}
      />
      <Tab.Screen name="More" component={MoreScreen} options={{title: 'More'}} />
    </Tab.Navigator>
  );
};

export default MainNavigator;
