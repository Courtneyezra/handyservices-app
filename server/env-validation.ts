/**
 * Environment Variable Validation
 *
 * Validates required environment variables exist at startup.
 * Fails fast with clear error messages rather than runtime failures.
 */

interface EnvVar {
  name: string;
  required: boolean;
  productionOnly?: boolean;
  validator?: (value: string) => boolean;
  description?: string;
}

const ENV_VARS: EnvVar[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection string',
  },
  {
    name: 'SESSION_SECRET',
    required: false, // Warn only - app generates fallback if missing
    description: 'Session encryption secret (min 16 chars)',
    validator: (v) => v.length >= 16,
  },
  {
    name: 'STRIPE_SECRET_KEY',
    required: true,
    productionOnly: true,
    description: 'Stripe API secret key',
    validator: (v) => v.startsWith('sk_'),
  },
  {
    name: 'OPENAI_API_KEY',
    required: true,
    productionOnly: true,
    description: 'OpenAI API key for AI features',
    validator: (v) => v.startsWith('sk-'),
  },
  {
    name: 'TWILIO_ACCOUNT_SID',
    required: true,
    productionOnly: true,
    description: 'Twilio Account SID',
    validator: (v) => v.startsWith('AC'),
  },
  {
    name: 'TWILIO_AUTH_TOKEN',
    required: true,
    productionOnly: true,
    description: 'Twilio Auth Token',
  },
  {
    name: 'WHATSAPP_VERIFY_TOKEN',
    required: false, // Warn only - WhatsApp features degrade gracefully
    productionOnly: true,
    description: 'Meta WhatsApp webhook verification token',
  },
  {
    name: 'META_APP_SECRET',
    required: false, // Warn only - WhatsApp signature verification skipped if missing
    productionOnly: true,
    description: 'Facebook App Secret for X-Hub-Signature-256 webhook verification',
  },
  {
    name: 'TWILIO_VIDEO_REQUEST_CONTENT_SID',
    required: false, // Warn only - video request feature disabled if missing
    productionOnly: true,
    description: 'Twilio Content SID for video request template (HX...)',
    validator: (v) => v.startsWith('HX'),
  },
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnvironment(): ValidationResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];
    const isRequired = envVar.required && (!envVar.productionOnly || isProduction);

    if (!value || value.trim() === '') {
      if (isRequired) {
        errors.push(
          `Missing required environment variable: ${envVar.name}` +
            (envVar.description ? ` (${envVar.description})` : '')
        );
      } else if (envVar.productionOnly && !isProduction) {
        warnings.push(`${envVar.name} not set (only required in production)`);
      }
      continue;
    }

    if (envVar.validator && !envVar.validator(value)) {
      errors.push(
        `Invalid format for ${envVar.name}` +
          (envVar.description ? ` - ${envVar.description}` : '')
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function requireValidEnvironment(): void {
  const result = validateEnvironment();

  for (const warning of result.warnings) {
    console.warn(`[Env] Warning: ${warning}`);
  }

  if (!result.valid) {
    console.error('\n[Env] FATAL: Environment validation failed\n');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    console.error('\nSet the missing environment variables and restart.\n');
    process.exit(1);
  }

  console.log('[Env] Environment validation passed');
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.trim() === '') {
    throw new Error(
      'SESSION_SECRET environment variable is required. ' +
        'Add SESSION_SECRET to your .env file. Generate with: openssl rand -base64 32'
    );
  }

  if (secret.length < 16) {
    throw new Error(
      'SESSION_SECRET must be at least 16 characters. ' +
        'Generate a secure one with: openssl rand -base64 32'
    );
  }

  return secret;
}