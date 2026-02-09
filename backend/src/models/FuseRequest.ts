import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IFuseRequest extends Document {
  beneficiary: string;
  tier: 'low' | 'medium' | 'high';
  ipAddress: string;
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
    index: true,
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
fuseRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // TTL: 90 days

export const FuseRequest = mongoose.model<IFuseRequest>('FuseRequest', fuseRequestSchema);
