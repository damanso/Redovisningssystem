import React, {useEffect} from 'react';
import {StatusBar, Platform} from 'react-native';
import RootNavigator from './src/navigation/RootNavigator';
import syncService from './src/services/sync';
import notificationService from './src/services/notifications';

const App: React.FC = () => {
  useEffect(() => {
    // Initialize services
    const initializeApp = async () => {
      // Request notification permissions
      if (Platform.OS === 'ios') {
        await notificationService.requestPermissions();
      }

      // Start auto-sync (every 15 minutes)
      syncService.startAutoSync(15);
    };

    initializeApp();

    // Cleanup on unmount
    return () => {
      syncService.stopAutoSync();
    };
  }, []);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#007AFF" />
      <RootNavigator />
    </>
  );
};

export default App;
