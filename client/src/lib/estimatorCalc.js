// The estimator engine lives in the function so the server owns the math;
// the browser imports the same file for live totals. One source of truth.
export * from '../../../functions/adasiq-api/services/estimator/calc.js'
