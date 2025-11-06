import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RootStackParamList} from '../../types';
import {useAuthStore} from '../../store/authStore';
import Input from '../../components/Input';
import Button from '../../components/Button';

type NavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const {login, isLoading, error} = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({email: '', password: ''});

  const validateForm = (): boolean => {
    const newErrors = {email: '', password: ''};
    let isValid = true;

    if (!email.trim()) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
      isValid = false;
    }

    if (!password) {
      newErrors.password = 'Password is required';
      isValid = false;
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await login({email, password});
    } catch (err) {
      Alert.alert('Login Failed', error || 'Please check your credentials');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={styles.title}>Redovisning</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={text => {
                setEmail(text);
                setErrors(prev => ({...prev, email: ''}));
              }}
              error={errors.email}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Enter your email"
            />

            <Input
              label="Password"
              value={password}
              onChangeText={text => {
                setPassword(text);
                setErrors(prev => ({...prev, password: ''}));
              }}
              error={errors.password}
              secureTextEntry
              placeholder="Enter your password"
            />

            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={isLoading}
              style={styles.button}
            />

            <Button
              title="Create Account"
              onPress={() => navigation.navigate('Register')}
              variant="secondary"
              disabled={isLoading}
              style={styles.button}
            />
          </View>
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
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 32,
  },
  form: {
    marginTop: 24,
  },
  button: {
    marginTop: 8,
  },
});

export default LoginScreen;
