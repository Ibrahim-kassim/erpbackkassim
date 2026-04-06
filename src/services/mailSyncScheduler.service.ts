import { syncAllTenantMailboxes } from './mailInbox.service';

let intervalHandle: NodeJS.Timeout | null = null;

export const startMailboxSyncScheduler = () => {
    if (intervalHandle) return;

    void syncAllTenantMailboxes();
    intervalHandle = setInterval(() => {
        void syncAllTenantMailboxes();
    }, 60 * 1000);
};
