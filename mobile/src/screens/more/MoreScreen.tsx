import React from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useAuthStore} from '../../store/authStore';
import syncService from '../../services/sync';
import Card from '../../components/Card';
import Button from '../../components/Button';

const MoreScreen: React.FC = () => {
  const {user, logout} = useAuthStore();

  const handleSync = async () => {
    const success = await syncService.forceSyncNow();
    if (success) {
      Alert.alert('Success', 'Data synchronized successfully');
    } else {
      Alert.alert('Error', 'Failed to synchronize data');
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  const MenuItem = ({
    icon,
    title,
    subtitle,
    onPress,
    color = '#007AFF',
  }: {
    icon: string;
    title: string;
    subtitle?: string;
    onPress: () => void;
    color?: string;
  }) => (
    <TouchableOpacity onPress={onPress}>
      <View style={styles.menuItem}>
        <View style={[styles.iconContainer, {backgroundColor: `${color}20`}]}>
          <Icon name={icon} size={24} color={color} />
        </View>
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>{title}</Text>
          {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
        </View>
        <Icon name="chevron-forward" size={24} color="#C7C7CC" />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.firstName?.charAt(0).toUpperCase() || 'U'}
          </Text>
        </View>
        <Text style={styles.name}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role}</Text>
      </Card>

      <Card style={styles.section}>
        <MenuItem
          icon="sync"
          title="Sync Data"
          subtitle="Synchronize with server"
          onPress={handleSync}
          color="#34C759"
        />
        <MenuItem
          icon="notifications"
          title="Notifications"
          subtitle="Manage notification settings"
          onPress={() => Alert.alert('Coming Soon', 'Notification settings')}
          color="#FF9500"
        />
        <MenuItem
          icon="settings"
          title="Settings"
          subtitle="App preferences"
          onPress={() => Alert.alert('Coming Soon', 'App settings')}
          color="#8E8E93"
        />
      </Card>

      <Card style={styles.section}>
        <MenuItem
          icon="help-circle"
          title="Help & Support"
          subtitle="Get help with the app"
          onPress={() => Alert.alert('Help', 'Contact support@example.com')}
          color="#5856D6"
        />
        <MenuItem
          icon="information-circle"
          title="About"
          subtitle="Version 1.0.0"
          onPress={() => Alert.alert('About', 'Redovisning Mobile App\nVersion 1.0.0')}
          color="#007AFF"
        />
      </Card>

      <View style={styles.logoutContainer}>
        <Button title="Logout" onPress={handleLogout} variant="danger" />
      </View>

      <Text style={styles.footer}>© 2024 Redovisningssystem</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  profileCard: {
    alignItems: 'center',
    margin: 16,
    padding: 24,
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
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 4,
  },
  role: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#E5F1FF',
    borderRadius: 12,
    marginTop: 8,
  },
  section: {
    margin: 16,
    marginTop: 0,
    padding: 0,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
    color: '#8E8E93',
  },
  logoutContainer: {
    padding: 16,
  },
  footer: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    padding: 16,
  },
});

export default MoreScreen;
