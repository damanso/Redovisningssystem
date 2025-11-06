import {create} from 'zustand';
import {DashboardStats} from '../types';
import apiService from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DashboardState {
  stats: DashboardStats | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: string | null;

  // Actions
  fetchStats: (forceRefresh?: boolean) => Promise<void>;
  clearError: () => void;
}

const CACHE_KEY = '@dashboard_stats';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useDashboardStore = create<DashboardState>((set, get) => ({
  stats: null,
  isLoading: false,
  error: null,
  lastRefresh: null,

  fetchStats: async (forceRefresh = false) => {
    const state = get();

    // Check if we need to refresh
    if (!forceRefresh && state.stats && state.lastRefresh) {
      const timeSinceLastRefresh = Date.now() - new Date(state.lastRefresh).getTime();
      if (timeSinceLastRefresh < CACHE_DURATION) {
        return; // Use cached data
      }
    }

    set({isLoading: true, error: null});

    try {
      // Try to load from cache first
      if (!forceRefresh) {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          const {stats, timestamp} = JSON.parse(cached);
          const age = Date.now() - timestamp;
          if (age < CACHE_DURATION) {
            set({
              stats,
              lastRefresh: new Date(timestamp).toISOString(),
              isLoading: false,
            });
            return;
          }
        }
      }

      // Fetch from API
      const response = await apiService.getDashboardStats();
      if (response.success) {
        const stats = response.data;
        const timestamp = Date.now();

        // Save to cache
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            stats,
            timestamp,
          }),
        );

        set({
          stats,
          lastRefresh: new Date(timestamp).toISOString(),
          isLoading: false,
        });
      }
    } catch (error: any) {
      // Try to use cached data on error
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const {stats, timestamp} = JSON.parse(cached);
        set({
          stats,
          lastRefresh: new Date(timestamp).toISOString(),
          error: 'Using cached data - ' + (error.message || 'Failed to fetch fresh data'),
          isLoading: false,
        });
      } else {
        set({
          error: error.message || 'Failed to fetch dashboard stats',
          isLoading: false,
        });
      }
    }
  },

  clearError: () => set({error: null}),
}));
