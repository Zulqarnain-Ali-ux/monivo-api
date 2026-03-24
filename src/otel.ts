/**
 * OpenTelemetry bootstrap.
 * Imported as the first line of main.ts — before any NestJS modules.
 *
 * Gracefully disabled when OTEL_ENABLED is not 'true' (default in dev).
 * Set OTEL_ENABLED=true in production to activate tracing and metrics.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter }  from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const enabled     = process.env.OTEL_ENABLED === 'true';
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'monivo-api';
const endpoint    = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

let sdk: NodeSDK | null = null;

if (enabled) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]:    serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
      environment: process.env.NODE_ENV ?? 'development',
    }),

    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 30_000,
    }),

    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return url.includes('/health/') || url.includes('/favicon');
          },
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] Tracing enabled → ${endpoint}`);

  process.on('SIGTERM', () => {
    sdk!.shutdown()
      .then(() => console.log('[OTel] SDK shut down cleanly'))
      .catch((e: Error) => console.error('[OTel] Shutdown error', e))
      .finally(() => process.exit(0));
  });
} else {
  // Dev / no collector: completely silent no-op
  // Set OTEL_ENABLED=true to activate
}

export { sdk };
