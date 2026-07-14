import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import schema from '../schemas/messages.json' with { type: 'json' };
import type { Message } from './types.js';

export * from './types.js';
export * from './skeleton.js';

export const messagesSchema = schema;

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validateFn: ValidateFunction = ajv.compile(schema);

export class ProtocolError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Validate an incoming raw value against the protocol schema. Throws ProtocolError. */
export function parseMessage(raw: unknown): Message {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!validateFn(value)) {
    throw new ProtocolError(
      `Invalid protocol message: ${ajv.errorsText(validateFn.errors)}`,
      validateFn.errors,
    );
  }
  return value as Message;
}

/** Type-check + serialize an outgoing message. Throws ProtocolError if it violates the schema. */
export function serializeMessage(msg: Message): string {
  if (!validateFn(msg)) {
    throw new ProtocolError(
      `Refusing to send invalid message: ${ajv.errorsText(validateFn.errors)}`,
      validateFn.errors,
    );
  }
  return JSON.stringify(msg);
}

/** Non-throwing variant for hot paths (pose frames). */
export function isValidMessage(value: unknown): value is Message {
  return validateFn(value) as boolean;
}
