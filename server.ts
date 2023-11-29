import {
  HLSPullPush,
  MediaPackageOutput,
  S3BucketOutput,
  VoidOutput
} from './index';
import { createLogger, transports, format, Logger } from 'winston';
import { ILogger } from './src/logger';
const { combine, timestamp, printf } = format;

class MyLogger implements ILogger {
  private logger: Logger;

  constructor(nodeEnv: string) {
    let level = 'debug';
    if (nodeEnv && nodeEnv === 'production') {
      level = 'info';
    }
    this.logger = createLogger({
      level: level,
      transports: [new transports.Console()],
      format: combine(
        timestamp(),
        printf(
          ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`
        )
      )
    });
  }

  info(message: string) {
    this.logger.info(message);
  }

  verbose(message: string) {
    this.logger.verbose(message);
  }

  warn(message: string) {
    this.logger.warn(message);
  }

  error(message: string) {
    this.logger.error(message);
  }
}

const pullPushService = new HLSPullPush(new MyLogger(process.env.NODE_ENV));
const outputPlugin = new MediaPackageOutput();
pullPushService.registerPlugin('mediapackage', outputPlugin);

pullPushService.getLogger().info('Running');
pullPushService.listen(process.env.PORT || 8080);

if (process.env.NODE_ENV === 'demo') {
  // In demo mode we want to automatically start a fetcher
  const outputDest = outputPlugin.createOutputDestination(
    {
      ingestUrls: [
        {
          url: process.env.DEMO_CHANNEL,
          username: process.env.DEMO_USERNAME,
          password: process.env.DEMO_PASSWORD
        }
      ]
    },
    pullPushService.getLogger()
  );
  const source = new URL(
    'https://demo.vc.eyevinn.technology/channels/demo/master.m3u8'
  );
  const sessionId = pullPushService.startFetcher({
    name: 'demo',
    url: source.href,
    destPlugin: outputDest,
    destPluginName: 'mediapackage'
  });
  outputDest.attachSessionId(sessionId);
}
