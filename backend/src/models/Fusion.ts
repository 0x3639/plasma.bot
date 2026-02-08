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
    index: true,
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

export const Fusion = mongoose.model<IFusion>('Fusion', fusionSchema);
