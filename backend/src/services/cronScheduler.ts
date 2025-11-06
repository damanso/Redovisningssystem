import cron from 'node-cron';
import * as recurringInvoiceService from './recurringInvoiceService.js';

let scheduledTask: cron.ScheduledTask | null = null;

// Initialize cron jobs
export const initCronJobs = () => {
  console.log('Initializing cron jobs...');

  // Run daily at 2:00 AM to process recurring invoices
  scheduledTask = cron.schedule('0 2 * * *', async () => {
    console.log('Running recurring invoice generation cron job...');

    try {
      const result = await recurringInvoiceService.processDueRecurringInvoices();

      console.log('Recurring invoice generation completed:');
      console.log(`  - Processed: ${result.processed}`);
      console.log(`  - Succeeded: ${result.succeeded}`);
      console.log(`  - Failed: ${result.failed}`);

      if (result.errors.length > 0) {
        console.error('Errors during processing:');
        result.errors.forEach(err => {
          console.error(`  - Recurring ID ${err.recurringId}: ${err.error}`);
        });
      }
    } catch (error: any) {
      console.error('Fatal error in recurring invoice cron job:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Europe/Stockholm' // Swedish timezone
  });

  console.log('Cron jobs initialized successfully');
  console.log('  - Recurring invoices: Daily at 2:00 AM (Europe/Stockholm)');
};

// Stop cron jobs (for graceful shutdown)
export const stopCronJobs = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log('Cron jobs stopped');
  }
};

// Run recurring invoice job manually (for testing or manual trigger)
export const runRecurringInvoiceJob = async () => {
  console.log('Manually running recurring invoice generation job...');

  try {
    const result = await recurringInvoiceService.processDueRecurringInvoices();

    console.log('Manual recurring invoice generation completed:');
    console.log(`  - Processed: ${result.processed}`);
    console.log(`  - Succeeded: ${result.succeeded}`);
    console.log(`  - Failed: ${result.failed}`);

    if (result.errors.length > 0) {
      console.error('Errors during processing:');
      result.errors.forEach(err => {
        console.error(`  - Recurring ID ${err.recurringId}: ${err.error}`);
      });
    }

    return result;
  } catch (error: any) {
    console.error('Fatal error in manual recurring invoice job:', error);
    throw error;
  }
};
