export default () => ({
    analytics: {
        measurementId: process.env['GA_MEASUREMENT_ID'] ?? process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'],
        apiSecret: process.env['GA_API_SECRET'] ?? process.env['NEXT_PUBLIC_GA_API_SECRET'],
    },
});