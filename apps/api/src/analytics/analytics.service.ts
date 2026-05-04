// analytics.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { setAnalyticsService } from './analytics.helper';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);
    private measurementId: string | undefined;
    private apiSecret: string | undefined;

    constructor(private configService: ConfigService) {
        this.measurementId = this.configService.get<string>('analytics.measurementId');
        this.apiSecret = this.configService.get<string>('analytics.apiSecret');
        setAnalyticsService(this);

        this.logger.log(
            `Analytics ready — measurementId: ${this.measurementId ?? 'NOT SET'}, ` +
            `apiSecret: ${this.apiSecret ? '***set***' : 'NOT SET'}`,
        );
    }

    async sendEvent({
        clientId,
        eventName,
        params = {},
    }: {
        clientId: string;
        eventName: string;
        params?: Record<string, any>;
    }) {
        if (!this.measurementId || !this.apiSecret) {
            this.logger.warn(`[GA] Skipping event "${eventName}" — measurementId or apiSecret not configured`);
            return;
        }

        // Always use the real collection endpoint so events are recorded in GA4
        // The debug endpoint (/debug/mp/collect) only validates — it never records events
        const base = 'https://www.google-analytics.com/mp/collect';
        const url = `${base}?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;

        const payload = {
            client_id: clientId,  // stable per user — passed from caller
            events: [
                {
                    name: eventName,
                    params: {
                        ...params,
                        engagement_time_msec: 100,
                    },
                },
            ],
        };

        try {
            const res = await axios.post(url, payload);
            // /mp/collect returns 204 No Content on success
            this.logger.log(`[GA] ✓ ${eventName} (client: ${clientId}) — sent (HTTP ${res.status})`);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error(`[GA] Event "${eventName}" failed: ${error.response?.data ?? error.message}`);
            } else {
                this.logger.error(`[GA] Event "${eventName}" failed: ${String(error)}`);
            }
        }
    }
}