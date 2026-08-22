import modelJson from '../../assets/models/focus-model.json';

/**
 * On-device inference for the focus-readiness model.
 *
 * The trained artifact is a scikit-learn pipeline of
 * SimpleImputer(median) -> StandardScaler -> LogisticRegression, which is arithmetic
 * rather than a network: standardise, dot product, sigmoid. Porting it means the
 * prediction needs no server and no ML runtime, and works with the aircraft door shut.
 * A TFLite or ONNX runtime would add a native module for something a loop can do.
 */

export type FocusFeature = (typeof model.features)[number];

interface FocusModel {
  model: string;
  target: string;
  note: string;
  features: readonly string[];
  impute_median: readonly number[];
  scale_mean: readonly number[];
  scale_std: readonly number[];
  coefficients: readonly number[];
  intercept: number;
  threshold: number;
  metrics_holdout: { roc_auc: number; f1: number; accuracy: number };
  trained_at: string;
  seed: number;
}

export const model = modelJson as FocusModel;

export interface FocusPrediction {
  probability: number;
  ready: boolean;
  /** Features the caller could not supply, filled from the training-set median. */
  imputedFeatures: string[];
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function predictFocusReady(inputs: Partial<Record<string, number>>): FocusPrediction {
  const imputedFeatures: string[] = [];
  let z = model.intercept;

  model.features.forEach((feature, i) => {
    const supplied = inputs[feature];
    const usable = supplied !== undefined && Number.isFinite(supplied);

    if (!usable) {
      imputedFeatures.push(feature);
    }

    const value = usable ? (supplied as number) : model.impute_median[i];

    // A zero standard deviation would mean the feature never varied in training, so it
    // carries no information — treat it as centred rather than dividing by zero.
    const std = model.scale_std[i];
    const standardised = std === 0 ? 0 : (value - model.scale_mean[i]) / std;

    z += model.coefficients[i] * standardised;
  });

  const probability = sigmoid(z);

  return {
    probability,
    ready: probability >= model.threshold,
    imputedFeatures,
  };
}

/** How many of the model's inputs were the user's own data rather than a population median. */
export function realFeatureCount(prediction: FocusPrediction): number {
  return model.features.length - prediction.imputedFeatures.length;
}
