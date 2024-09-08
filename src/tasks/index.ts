import { ToadScheduler, SimpleIntervalJob } from "toad-scheduler";
import syncStores from "./sync_stores";
import ipRefresh from './ip_refresh' ;

type JobRegistry = {
  [key: string]: SimpleIntervalJob;
};

const scheduler = new ToadScheduler();
const jobRegistry: JobRegistry = {};

const addJobToScheduler = (job: SimpleIntervalJob): void => {
  if (job.id) {
    jobRegistry[job.id] = job;
    scheduler.addSimpleIntervalJob(job);
  }
};

const start = (): void => {
  // Add default jobs
  const defaultJobs: SimpleIntervalJob[] = [syncStores, ipRefresh];

  defaultJobs.forEach((defaultJob) => {
    if (defaultJob.id) {
      jobRegistry[defaultJob.id] = defaultJob;
      scheduler.addSimpleIntervalJob(defaultJob);
    }
  });
};

const getJobStatus = (): { [key: string]: string } => {
  return Object.keys(jobRegistry).reduce((status, key) => {
    status[key] = jobRegistry[key].getStatus();
    return status;
  }, {} as { [key: string]: string });
};

export default { start, addJobToScheduler, jobRegistry, getJobStatus };
