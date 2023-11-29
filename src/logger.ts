export interface ILogger {
  verbose: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export class AbstractLogger implements ILogger {
  private doLog(level: string, message: string) {
    console.log(`${level}: ${message}`);
  }

  verbose(message: string) {
    this.doLog('VERBOSE', message);
  }

  info(message: string) {
    this.doLog('INFO', message);
  }

  warn(message: string) {
    this.doLog('WARN', message);
  }

  error(message: string) {
    console.error(message);
  }
}
