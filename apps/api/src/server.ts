import { loadEnv } from '@dharma-events/shared';
import { buildApp } from './app.js';

const env = loadEnv();
const app = buildApp(env);

app
  .listen({ port: 3000, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Dharma Events API listening (env=${env.NODE_ENV})`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
