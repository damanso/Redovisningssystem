import {create} from 'zustand';
import {User, LoginForm, RegisterForm} from '../types';
import apiService from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginForm) => Promise<void>;
  register: (data: RegisterForm) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (credentials: LoginForm) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.login(credentials);
      if (response.success) {
        set({
          user: response.data.user,
          token: response.data.token,
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch (error: any) {
      set({
        error: error.message || 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  register: async (data: RegisterForm) => {
    set({isLoading: true, error: null});
    try {
      const response = await apiService.register(data);
      if (response.success) {
        set({
          user: response.data.user,
          token: response.data.token,
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch (error: any) {
      set({
        error: error.message || 'Registration failed',
        isLoading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await apiService.logout();
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        error: null,
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  },

  loadUser: async () => {
    set({isLoading: true});
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        const response = await apiService.getCurrentUser();
        if (response.success) {
          set({
            user: response.data,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
        } else {
          set({isLoading: false, isAuthenticated: false});
        }
      } else {
        set({isLoading: false, isAuthenticated: false});
      }
    } catch (error) {
      set({isLoading: false, isAuthenticated: false});
    }
  },

  clearError: () => set({error: null}),
}));
