import { Controller, Get } from '@nestjs/common';
import * as os from 'os';

@Controller('api/runtime/health')
export class RuntimeHealthController {
  @Get()
  getRuntimeHealth() {
    return {
      ok: true,
      runtimeMode: process.env.ELECTRON_RUNTIME_MODE || 'standalone',
      serverName: os.hostname(),
      version: process.env.APP_VERSION || process.env.npm_package_version || 'dev',
    };
  }
}
