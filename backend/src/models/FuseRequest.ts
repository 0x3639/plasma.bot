import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IFuseRequest extends Document {
  beneficiary: string;
  tier: 'low' | 'medium' | 'high';
  ipAddress: string;
  source: 'web' | 'telegram' | 'api';
  telegramUserId: number | null;
  fusion: Types.ObjectId | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'rate_limited';
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const fuseRequestSchema = new Schema<IFuseRequest>({
  beneficiary: {
    type: String,
    required: true,
    // No standalone index here — the compound { beneficiary, status } index and
    // the partial-unique index below both cover beneficiary-prefixed queries.
  },
  tier: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high'],
  },
  ipAddress: {
    type: String,
    required: true,
    index: true,
  },
  source: {
    type: String,
    required: true,
    default: 'web',
    enum: ['web', 'telegram', 'api'],
  },
  telegramUserId: {
    type: Number,
    default: null,
  },
  fusion: {
    type: Schema.Types.ObjectId,
    ref: 'Fusion',
    default: null,
  },
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'processing', 'completed', 'failed', 'rate_limited'],
  },
  errorMessage: {
    type: String,
    default: null,
  },
}, { timestamps: true });

fuseRequestSchema.index({ ipAddress: 1, createdAt: 1 });
fuseRequestSchema.index({ beneficiary: 1, status: 1 });                       // address rate limiter
fuseRequestSchema.index({ telegramUserId: 1, createdAt: 1 });                       // Telegram rate limiter
fuseRequestSchema.index({ source: 1, createdAt: 1 });                               // global daily cap (agent)
fuseRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // TTL: 90 days

// Race lock: at most one in-flight ('processing') request per beneficiary.
// Two concurrent requests for the same address can both pass checkAddressAvailability
// (neither sees the other's not-yet-created record); this DB-level unique constraint
// makes the second FuseRequest.create() throw E11000 so the handler can reject it.
fuseRequestSchema.index(
  { beneficiary: 1 },
  {
    name: 'beneficiary_processing_unique',
    unique: true,
    partialFilterExpression: { status: 'processing' },
  },
);

export const FuseRequest = mongoose.model<IFuseRequest>('FuseRequest', fuseRequestSchema);
