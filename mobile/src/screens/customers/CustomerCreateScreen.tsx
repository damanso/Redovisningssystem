import React, {useState, useEffect} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {CustomerStackParamList, CustomerForm} from '../../types';
import {useCustomerStore} from '../../store/customerStore';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Loading from '../../components/Loading';

type RouteType = RouteProp<CustomerStackParamList, 'CustomerEdit'>;

const CustomerCreateScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteType>();
  const customerId = (route.params as any)?.customerId;

  const {
    selectedCustomer,
    isLoading,
    fetchCustomer,
    createCustomer,
    updateCustomer,
  } = useCustomerStore();

  const [formData, setFormData] = useState<CustomerForm>({
    name: '',
    organizationNumber: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
    country: 'Sweden',
    notes: '',
    contactPerson: '',
    paymentTerms: 30,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (customerId) {
      fetchCustomer(customerId);
    }
  }, [customerId]);

  useEffect(() => {
    if (customerId && selectedCustomer) {
      setFormData({
        name: selectedCustomer.name,
        organizationNumber: selectedCustomer.organizationNumber,
        email: selectedCustomer.email,
        phone: selectedCustomer.phone,
        address: selectedCustomer.address,
        city: selectedCustomer.city,
        postalCode: selectedCustomer.postalCode,
        country: selectedCustomer.country,
        notes: selectedCustomer.notes || '',
        contactPerson: selectedCustomer.contactPerson || '',
        paymentTerms: selectedCustomer.paymentTerms,
      });
    }
  }, [selectedCustomer]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
      isValid = false;
    }

    if (!formData.organizationNumber.trim()) {
      newErrors.organizationNumber = 'Organization number is required';
      isValid = false;
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
      isValid = false;
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
      isValid = false;
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
      isValid = false;
    }

    if (!formData.city.trim()) {
      newErrors.city = 'City is required';
      isValid = false;
    }

    if (!formData.postalCode.trim()) {
      newErrors.postalCode = 'Postal code is required';
      isValid = false;
    }

    if (!formData.country.trim()) {
      newErrors.country = 'Country is required';
      isValid = false;
    }

    if (formData.paymentTerms <= 0) {
      newErrors.paymentTerms = 'Payment terms must be greater than 0';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      if (customerId) {
        await updateCustomer(customerId, formData);
        Alert.alert('Success', 'Customer updated successfully');
      } else {
        await createCustomer(formData);
        Alert.alert('Success', 'Customer created successfully');
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to save customer');
    }
  };

  const updateField = (field: keyof CustomerForm, value: string | number) => {
    setFormData(prev => ({...prev, [field]: value}));
    setErrors(prev => ({...prev, [field]: ''}));
  };

  if (customerId && isLoading && !selectedCustomer) {
    return <Loading />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Input
          label="Company Name *"
          value={formData.name}
          onChangeText={text => updateField('name', text)}
          error={errors.name}
          placeholder="Enter company name"
        />

        <Input
          label="Organization Number *"
          value={formData.organizationNumber}
          onChangeText={text => updateField('organizationNumber', text)}
          error={errors.organizationNumber}
          placeholder="Enter organization number"
        />

        <Input
          label="Email *"
          value={formData.email}
          onChangeText={text => updateField('email', text)}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="Enter email address"
        />

        <Input
          label="Phone *"
          value={formData.phone}
          onChangeText={text => updateField('phone', text)}
          error={errors.phone}
          keyboardType="phone-pad"
          placeholder="Enter phone number"
        />

        <Input
          label="Contact Person"
          value={formData.contactPerson}
          onChangeText={text => updateField('contactPerson', text)}
          placeholder="Enter contact person name"
        />

        <Input
          label="Address *"
          value={formData.address}
          onChangeText={text => updateField('address', text)}
          error={errors.address}
          placeholder="Enter street address"
        />

        <Input
          label="Postal Code *"
          value={formData.postalCode}
          onChangeText={text => updateField('postalCode', text)}
          error={errors.postalCode}
          placeholder="Enter postal code"
        />

        <Input
          label="City *"
          value={formData.city}
          onChangeText={text => updateField('city', text)}
          error={errors.city}
          placeholder="Enter city"
        />

        <Input
          label="Country *"
          value={formData.country}
          onChangeText={text => updateField('country', text)}
          error={errors.country}
          placeholder="Enter country"
        />

        <Input
          label="Payment Terms (days) *"
          value={formData.paymentTerms.toString()}
          onChangeText={text => updateField('paymentTerms', parseInt(text) || 0)}
          error={errors.paymentTerms}
          keyboardType="number-pad"
          placeholder="30"
        />

        <Input
          label="Notes"
          value={formData.notes}
          onChangeText={text => updateField('notes', text)}
          placeholder="Additional notes"
          multiline
          numberOfLines={4}
          style={styles.notesInput}
        />

        <Button
          title={customerId ? 'Update Customer' : 'Create Customer'}
          onPress={handleSave}
          loading={isLoading}
          style={styles.button}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  notesInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  button: {
    marginTop: 16,
    marginBottom: 32,
  },
});

export default CustomerCreateScreen;
