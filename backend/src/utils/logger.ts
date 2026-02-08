import winston from 'winston';

const SENSITIVE_PATTERNS = [
  { regex: /\b[a-z]+(?:\s+[a-z]+){11,23}\b/gi, replacement: '[MNEMONIC_REDACTED]' },
  { regex: /(?:private[_-]?key|privateKey|secret|mnemonic|entropy|password|passphrase|admin[_-]?(?:api[_-]?)?key)\s*[:=]\s*["']?[^\s"',}{]+/gi, replacement: '[SENSITIVE_REDACTED]' },
  { regex: /KEYFILE_PASSWORD\s*[:=]\s*\S+/gi, replacement: 'KEYFILE_PASSWORD=[REDACTED]' },
  { regex: /ADMIN_API_KEY\s*[:=]\s*\S+/gi, replacement: 'ADMIN_API_KEY=[REDACTED]' },
];

export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    let sanitized = value;
    for (const { regex, replacement } of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(regex, replacement);
    }
    return sanitized;
  }
  if (typeof value === 'object' && value !== null) {
    if (value instanceof Error) {
      return {
        message: sanitize(value.message),
        stack: sanitize(value.stack),
      };
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('mnemonic') ||
          lowerKey.includes('privatekey') || lowerKey.includes('secret') ||
          lowerKey.includes('entropy') || lowerKey.includes('captchatoken') ||
          lowerKey.includes('apikey') || lowerKey.includes('api_key')) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitize(val);
      }
    }
    return sanitized;
  }
  return value;
}

const sanitizeFormat = winston.format((info) => {
  info.message = sanitize(info.message) as string;
  if (info.error) {
    info.error = sanitize(info.error);
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
});
