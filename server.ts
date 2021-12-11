import { HLSPullPush, MediaPackageOutput } from "./index";
import { ILogger } from "./types/index";
import { createLogger, transports, format, Logger } from "winston";
const { combine, timestamp, printf } = format;

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

  error(message: string) {
    this.logger.error(message);
  }
}

const pullPushService = new HLSPullPush(new MyLogger(process.env.NODE_ENV));
pullPushService.registerPlugin("mediapackage", new MediaPackageOutput());

pullPushService.getLogger().info("Running");
pullPushService.listen(process.env.PORT || 8080);

