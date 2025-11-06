import React, {useState} from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useAuthStore} from '../../store/authStore';
import Input from '../../components/Input';
import Button from '../../components/Button';

const RegisterScreen: React.FC = () => {
  const navigation = useNavigation();
  const {register, isLoading, error} = useAuthStore();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });

  const [errors, setErrors] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });

  const validateForm = (): boolean => {
    const newErrors = {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
    };
    let isValid = true;

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
      isValid = false;
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
      isValid = false;
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
      isValid = false;
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      isValid = false;
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
      isValid = false;
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
      isValid = false;
    }

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
      isValid = false;
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleRegister = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await register(formData);
    } catch (err) {
      Alert.alert('Registration Failed', error || 'Please try again');
    }
  };

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({...prev, [field]: value}));
    setErrors(prev => ({...prev, [field]: ''}));
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Input
            label="Username"
            value={formData.username}
            onChangeText={text => updateField('username', text)}
            error={errors.username}
            autoCapitalize="none"
            placeholder="Choose a username"
          />

          <Input
            label="Email"
            value={formData.email}
            onChangeText={text => updateField('email', text)}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter your email"
          />

          <Input
            label="First Name"
            value={formData.firstName}
            onChangeText={text => updateField('firstName', text)}
            error={errors.firstName}
            placeholder="Enter your first name"
          />

          <Input
            label="Last Name"
            value={formData.lastName}
            onChangeText={text => updateField('lastName', text)}
            error={errors.lastName}
            placeholder="Enter your last name"
          />

          <Input
            label="Password"
            value={formData.password}
            onChangeText={text => updateField('password', text)}
            error={errors.password}
            secureTextEntry
            placeholder="Choose a password"
          />

          <Input
            label="Confirm Password"
            value={formData.confirmPassword}
            onChangeText={text => updateField('confirmPassword', text)}
            error={errors.confirmPassword}
            secureTextEntry
            placeholder="Confirm your password"
          />

          <Button
            title="Create Account"
            onPress={handleRegister}
            loading={isLoading}
            style={styles.button}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 24,
  },
  button: {
    marginTop: 16,
  },
});

export default RegisterScreen;
