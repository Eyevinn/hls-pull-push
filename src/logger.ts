export interface ILogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

export class AbstractLogger implements ILogger {
  private doLog(level: string, message: string) {
    console.log(`${level}: ${message}`);
  }

  debug(message: string) {
    this.doLog("DEBUG", message);
  }

  info(message: string) {
    this.doLog("INFO", message);
  }

  error(message: string) {
    console.error(message);
  }
}