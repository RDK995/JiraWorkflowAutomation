const DEFAULT_CORS_ORIGIN = "http://localhost:5173";

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function withCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.PRONTO_CORS_ORIGIN || DEFAULT_CORS_ORIGIN);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

export function sendJson(response, statusCode, payload) {
  withCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export function sendText(response, statusCode, payload, type = "text/plain; charset=utf-8") {
  withCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": type });
  response.end(payload);
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}
