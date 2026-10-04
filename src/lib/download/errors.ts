export class DownloadRequestError extends Error {
  code: "denied" | "failed" | "unauthorized";
  constructor(code: "denied" | "failed" | "unauthorized") {
    super(code);
    this.code = code;
  }
}
