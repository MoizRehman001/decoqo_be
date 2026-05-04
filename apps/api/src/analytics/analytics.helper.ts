// analytics.helper.ts
let analyticsServiceRef: any;

export const setAnalyticsService = (service: any) => {
    analyticsServiceRef = service;
};
// const isDebug = process.env.NODE_ENV !== 'production';
const isDebug = true;
export const track = (
    event: string,
    clientId: string,
    params?: Record<string, any>,
) => {
    if (!analyticsServiceRef) return;
    console.log('TRACK EVENT:', event); // ✅ ADD THIS
    analyticsServiceRef
        .sendEvent({
            clientId,
            eventName: event,
            params: {
                ...(params || {}),
                ...(isDebug && { debug_mode: true }),
            },
        })
        .catch(() => { });
};