import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({icon, title, message}) => {
  return (
    <View style={styles.container}>
      <Icon name={icon} size={64} color="#C7C7CC" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
  },
});

export default EmptyState;
