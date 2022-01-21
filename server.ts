import { HLSPullPush, MediaPackageOutput, S3BucketOutput } from "./index";
import { ILogger } from "./types/index";
import { createLogger, transports, format, Logger } from "winston";
const { combine, timestamp, printf } = format;

require('dotenv').config();

class MyLogger implements ILogger {
  private logger: Logger;

  constructor(nodeEnv: string) {
    let level = "debug";
    if (nodeEnv && nodeEnv === "production") {
      level = "info"
    }
    this.logger = createLogger({
      level: level,
      transports: [ new transports.Console() ],
      format: combine(
        timestamp(),
        printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)    
      ),
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
const outputPlugin_mp = new MediaPackageOutput();
pullPushService.registerPlugin("mediapackage", outputPlugin_mp);

const outputPlugin_s3 = new S3BucketOutput();
pullPushService.registerPlugin("s3", outputPlugin_s3);

pullPushService.getLogger().info("Running");
pullPushService.listen(process.env.PORT || 8080);
