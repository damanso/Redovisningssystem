import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import Card from '../../components/Card';
import Button from '../../components/Button';

const ReceiptDetailScreen: React.FC = () => {
  return (
    <ScrollView style={styles.container}>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Receipt Details</Text>
        <Text style={styles.placeholder}>Receipt details will be displayed here</Text>
      </Card>

      <View style={styles.actions}>
        <Button title="Approve" variant="primary" onPress={() => {}} />
        <Button title="Reject" variant="danger" onPress={() => {}} style={styles.button} />
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
  placeholder: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    padding: 32,
  },
  actions: {
    padding: 16,
  },
  button: {
    marginTop: 12,
  },
});

export default ReceiptDetailScreen;
