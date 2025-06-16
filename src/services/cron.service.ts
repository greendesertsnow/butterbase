import cron from 'node-cron';

interface ScheduledTask {
  id: string;
  schedule: string; // Cron pattern string (e.g., '0 * * * *')
  task: () => void | Promise<void>;
  description?: string;
  isRunning: boolean;
  jobInstance?: cron.ScheduledTask;
}

class CronService {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor() {
    console.log('CronService initialized.');
    // Example: Load tasks from a configuration or database in a real app
  }

  /**
   * Defines and schedules a new cron job.
   * If a job with the same ID already exists, it will be updated (stopped and rescheduled).
   * @param id A unique identifier for the task.
   * @param schedule The cron pattern (e.g., '0 0 * * *' for daily at midnight).
   * @param task The function to execute.
   * @param description Optional description of the task.
   * @param autoStart Start the job immediately after scheduling. Default is true.
   */
  scheduleJob(
    id: string,
    schedule: string,
    task: () => void | Promise<void>,
    description?: string,
    autoStart: boolean = true
  ): boolean {
    if (!cron.validate(schedule)) {
      console.error(`[CronService] Invalid cron schedule "${schedule}" for job ID "${id}".`);
      return false;
    }

    // If job already exists, stop and remove it before rescheduling
    if (this.scheduledTasks.has(id)) {
      this.stopJob(id);
      this.removeJob(id);
    }

    const jobWrapper = async () => {
      console.log(`[CronService] Running job "${id}" (${description || 'No description'}).`);
      try {
        await Promise.resolve(task()); // Handles both sync and async tasks
        console.log(`[CronService] Job "${id}" completed successfully.`);
      } catch (error) {
        console.error(`[CronService] Job "${id}" failed:`, error);
      }
    };

    const jobInstance = cron.schedule(schedule, jobWrapper, {
      scheduled: false, // Will be started manually if autoStart is true
      name: id,
      // timezone: "Your/Timezone" // Optional: specify timezone
    });

    const scheduledTask: ScheduledTask = {
      id,
      schedule,
      task: jobWrapper, // Store the wrapper
      description,
      isRunning: false,
      jobInstance,
    };
    this.scheduledTasks.set(id, scheduledTask);

    if (autoStart) {
      this.startJob(id);
    }

    console.log(`[CronService] Job "${id}" scheduled: ${schedule} - ${description || 'No description'}. Auto-started: ${autoStart}`);
    return true;
  }

  startJob(id: string): boolean {
    const task = this.scheduledTasks.get(id);
    if (task && task.jobInstance) {
      task.jobInstance.start();
      task.isRunning = true;
      console.log(`[CronService] Job "${id}" started.`);
      return true;
    }
    console.warn(`[CronService] Job "${id}" not found or no instance to start.`);
    return false;
  }

  stopJob(id: string): boolean {
    const task = this.scheduledTasks.get(id);
    if (task && task.jobInstance) {
      task.jobInstance.stop();
      task.isRunning = false;
      console.log(`[CronService] Job "${id}" stopped.`);
      return true;
    }
    console.warn(`[CronService] Job "${id}" not found or no instance to stop.`);
    return false;
  }

  removeJob(id: string): boolean {
    const task = this.scheduledTasks.get(id);
    if (task) {
      if (task.jobInstance) {
        task.jobInstance.stop(); // Ensure it's stopped before removing
      }
      this.scheduledTasks.delete(id);
      console.log(`[CronService] Job "${id}" removed.`);
      return true;
    }
    console.warn(`[CronService] Job "${id}" not found for removal.`);
    return false;
  }

  listJobs(): ScheduledTask[] {
    return Array.from(this.scheduledTasks.values()).map(task => ({
        // Return a copy without the jobInstance to avoid external manipulation
        id: task.id,
        schedule: task.schedule,
        task: task.task, // The wrapped task
        description: task.description,
        isRunning: task.isRunning,
        // jobInstance is not returned for external use
    }));
  }
}

// Export a singleton instance
export const cronService = new CronService();

// --- Example Cron Job Registration ---
// This is where you would define specific cron jobs for your application.
// This should ideally be done in a separate file or module that imports cronService.

function registerApplicationCronJobs() {
  // Example: A job that runs every minute
  // cronService.scheduleJob(
  //   'sample-minute-job',
  //   '* * * * *',
  //   () => {
  //     console.log('[SampleJob] This job runs every minute!');
  //     // Add your task logic here, e.g., call another service
  //   },
  //   'A sample job that logs a message every minute.'
  // );

  // Example: A job that runs daily at 2 AM
  // cronService.scheduleJob(
  //   'daily-cleanup',
  //   '0 2 * * *',
  //   async () => {
  //     console.log('[DailyCleanupJob] Starting daily cleanup...');
  //     // Example: await someAsyncCleanupTask();
  //     console.log('[DailyCleanupJob] Daily cleanup finished.');
  //   },
  //   'Performs daily cleanup tasks at 2 AM.'
  // );

  console.log("Application-specific cron jobs registration point called.");
  // If there are actual cron jobs to port from the Go app's tools/cron/,
  // they would be defined and scheduled here by calling cronService.scheduleJob(...)
}

// Call this function during application startup to register jobs.
// This should be done *after* all services the jobs might depend on are initialized.
export { registerApplicationCronJobs };

console.log('Cron service (cron.service.ts) created.');
