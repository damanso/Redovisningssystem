import PushNotification, {Importance} from 'react-native-push-notification';
import {Platform} from 'react-native';

class NotificationService {
  constructor() {
    this.configure();
    this.createDefaultChannels();
  }

  configure() {
    PushNotification.configure({
      // Called when Token is generated (iOS and Android)
      onRegister: function (token) {
        console.log('TOKEN:', token);
        // Send token to backend
      },

      // Called when a remote or local notification is opened or received
      onNotification: function (notification) {
        console.log('NOTIFICATION:', notification);

        // Handle notification click
        if (notification.userInteraction) {
          // User clicked on notification
          // Navigate to appropriate screen based on notification data
        }
      },

      // Android only: GCM or FCM Sender ID
      senderID: 'YOUR_SENDER_ID',

      // iOS only
      permissions: {
        alert: true,
        badge: true,
        sound: true,
      },

      // Should the initial notification be popped automatically
      popInitialNotification: true,

      requestPermissions: Platform.OS === 'ios',
    });
  }

  createDefaultChannels() {
    PushNotification.createChannel(
      {
        channelId: 'invoices',
        channelName: 'Invoices',
        channelDescription: 'Invoice notifications',
        importance: Importance.HIGH,
        vibrate: true,
      },
      created => console.log(`Channel 'invoices' created: ${created}`),
    );

    PushNotification.createChannel(
      {
        channelId: 'payments',
        channelName: 'Payments',
        channelDescription: 'Payment notifications',
        importance: Importance.HIGH,
        vibrate: true,
      },
      created => console.log(`Channel 'payments' created: ${created}`),
    );

    PushNotification.createChannel(
      {
        channelId: 'reminders',
        channelName: 'Reminders',
        channelDescription: 'Reminder notifications',
        importance: Importance.DEFAULT,
        vibrate: false,
      },
      created => console.log(`Channel 'reminders' created: ${created}`),
    );
  }

  showLocalNotification(
    title: string,
    message: string,
    channelId: string = 'invoices',
    data?: any,
  ) {
    PushNotification.localNotification({
      channelId,
      title,
      message,
      playSound: true,
      soundName: 'default',
      userInfo: data,
    });
  }

  scheduleNotification(
    title: string,
    message: string,
    date: Date,
    channelId: string = 'reminders',
    data?: any,
  ) {
    PushNotification.localNotificationSchedule({
      channelId,
      title,
      message,
      date,
      playSound: true,
      soundName: 'default',
      userInfo: data,
    });
  }

  cancelAllNotifications() {
    PushNotification.cancelAllLocalNotifications();
  }

  // Invoice notifications
  notifyInvoiceCreated(invoiceNumber: string) {
    this.showLocalNotification(
      'Invoice Created',
      `Invoice ${invoiceNumber} has been created successfully`,
      'invoices',
    );
  }

  notifyInvoiceSent(invoiceNumber: string) {
    this.showLocalNotification(
      'Invoice Sent',
      `Invoice ${invoiceNumber} has been sent to customer`,
      'invoices',
    );
  }

  notifyInvoiceOverdue(invoiceNumber: string, daysOverdue: number) {
    this.showLocalNotification(
      'Invoice Overdue',
      `Invoice ${invoiceNumber} is ${daysOverdue} days overdue`,
      'reminders',
    );
  }

  // Payment notifications
  notifyPaymentReceived(invoiceNumber: string, amount: number) {
    this.showLocalNotification(
      'Payment Received',
      `Payment of ${amount} SEK received for invoice ${invoiceNumber}`,
      'payments',
    );
  }

  // Reminder notifications
  scheduleInvoiceDueReminder(invoiceNumber: string, dueDate: Date) {
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 3); // 3 days before due

    this.scheduleNotification(
      'Invoice Due Soon',
      `Invoice ${invoiceNumber} is due in 3 days`,
      reminderDate,
      'reminders',
    );
  }

  // Request permissions
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      return new Promise((resolve, reject) => {
        PushNotification.requestPermissions()
          .then(permissions => {
            resolve(permissions.alert && permissions.badge && permissions.sound);
          })
          .catch(error => {
            reject(error);
          });
      });
    }
    return true; // Android doesn't need explicit permission request
  }

  // Get notification settings
  checkPermissions(callback: (permissions: any) => void) {
    PushNotification.checkPermissions(callback);
  }
}

export default new NotificationService();
