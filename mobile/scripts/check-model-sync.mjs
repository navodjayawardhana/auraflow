#!/usr/bin/env node
/**
 * Fails if the bundled model has drifted from the trained artifact.
 *
 * Metro cannot import above the project root, so the app ships a *copy* of
 * ml/artifacts/focus_model_coefficients.json. A copy can silently go stale — the model
 * gets retrained, the app keeps predicting from the old coefficients, and the report
 * quotes metrics the app is not actually using. This check makes that impossible to
 * miss rather than impossible to happen.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../../ml/artifacts/focus_model_coefficients.json');
const BUNDLED = resolve(here, '../assets/models/focus-model.json');

function sha256(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch (error) {
    console.error(`Could not read ${path}: ${error.message}`);
    process.exit(1);
  }
}

const sourceHash = sha256(SOURCE);
const bundledHash = sha256(BUNDLED);

if (sourceHash !== bundledHash) {
  console.error('Bundled focus model is out of sync with the trained artifact.');
  console.error(`  ml/artifacts: ${sourceHash}`);
  console.error(`  mobile/assets: ${bundledHash}`);
  console.error('Run: cp ../ml/artifacts/focus_model_coefficients.json assets/models/focus-model.json');
  process.exit(1);
}

console.log(`Focus model in sync (${sourceHash.slice(0, 12)}…).`);
