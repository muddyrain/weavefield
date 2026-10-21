import 'dotenv/config';
import { createApplication } from './application';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '127.0.0.1');
  console.log(`[api] http://127.0.0.1:${port}/health`);
}
void bootstrap();
