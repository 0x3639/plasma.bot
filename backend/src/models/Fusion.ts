import mongoose, { Schema, type Document } from 'mongoose';

export interface IFusion extends Document {
  fusionId: string | null;
  expirationHeight: number | null;
  beneficiary: string;
  tier: 'low' | 'medium' | 'high';
  qsrAmount: number;
  txHash: string;
  status: 'active' | 'unfusing' | 'unfused' | 'failed';
  fusedAt: Date;
  unfusedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fusionSchema = new Schema<IFusion>({
  fusionId: {
    type: String,
    default: null,
  },
  expirationHeight: {
    type: Number,
    default: null,
  },
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
  qsrAmount: {
    type: Number,
    required: true,
  },
  txHash: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    required: true,
    default: 'active',
    enum: ['active', 'unfusing', 'unfused', 'failed'],
    index: true,
  },
  fusedAt: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  unfusedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

// Compound indexes for hot queries
fusionSchema.index({ status: 1, expirationHeight: 1 }); // unfuse cycle: revocable fusions
fusionSchema.index({ beneficiary: 1, status: 1 });       // rate limiter: active fusion per address
fusionSchema.index({ fusionId: 1, status: 1 });           // reconciliation query
fusionSchema.index({ fusionId: 1 }, { unique: true, partialFilterExpression: { fusionId: { $type: 'string' } } }); // prevent duplicate fusionId assignments
fusionSchema.index({ txHash: 1 }, { unique: true });      // prevent duplicate tx records

export const Fusion = mongoose.model<IFusion>('Fusion', fusionSchema);
