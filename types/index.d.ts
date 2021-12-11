export interface ILogger {
  verbose: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}
